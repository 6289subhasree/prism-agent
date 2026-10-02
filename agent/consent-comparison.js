const { randomUUID } = require('node:crypto');
const { z } = require('zod');
const { createSessionManager } = require('./session-manager');
const hostCounts = z.array(z.object({ hostname: z.string(), count: z.number().int().nonnegative(), thirdParty: z.boolean() }));
const observation = z.object({
  status: z.enum(['observed', 'skipped']),
  reason: z.string().optional(),
  clickedLabel: z.string().optional(),
  controlDismissed: z.boolean().optional(),
  beforeDomains: z.array(z.string()).default([]),
  afterDomains: z.array(z.string()).default([]),
  afterRequests: z.number().int().nonnegative().default(0),
  observationMs: z.literal(3000).optional(),
  finalUrl: z.string().url().optional(),
  beforeRequestsByHostname: hostCounts.optional(),
  afterRequestsByHostname: hostCounts.optional(),
  classification: z.object({
    method: z.literal('registrable-domain'), version: z.literal(1), privateSuffixes: z.literal(true),
    referenceUrl: z.string().url(), referenceHostname: z.string(), referenceDomain: z.string(),
  }).optional(),
});

async function compareConsent({ run, parseJson, runExperiment, now = Date.now }) {
  const runs = [];
  for (const choice of ['reject', 'accept']) {
    // A slow first choice must not consume the second choice's allowance.
    const startedAt = now();
    const deadline = startedAt + 60000;
    const profileId = `prism-${choice}-${randomUUID()}`;
    const warnings = [];
    const remaining = (step = "browser experiment") => {
      const budget = Math.min(30000, deadline - now());
      if (budget <= 0) throw Object.assign(new Error(`Consent ${choice} exhausted its 60s budget before ${step}`), { code: 'CONSENT_TIMEOUT' });
      return budget;
    };
    const scopedRun = (args, timeout) => run(['--profile', profileId, ...args], timeout);
    const sessions = createSessionManager({ run: scopedRun, parseJson, remaining, onWarning: warning => warnings.push(warning) });
    try {
      const profile = parseJson(run(['profile', 'create', profileId, '-f', 'json'], remaining('profile create')), 'profile create');
      if (profile.created !== true) throw new Error('Webcmd did not confirm a fresh profile; comparison skipped');
      const result = await sessions.withSession(sessionId => runExperiment({ sessionId, choice, run: scopedRun, timeoutMs: remaining() }));
      runs.push({ choice, profileId, ...observation.parse(result), warnings, durationMs: now() - startedAt, budgetMs: 60000 });
    } catch (error) {
      runs.push({ choice, profileId, status: 'failed', reason: error.message, errorCode: error.code || 'CONSENT_FAILED', warnings, durationMs: now() - startedAt, budgetMs: 60000 });
    }
  }
  const reject = runs[0], accept = runs[1];
  const comparable = runs.every(run => run.status === 'observed' && run.controlDismissed === true && run.observationMs === 3000);
  return {
    status: comparable ? 'completed' : 'partial', runs,
    comparison: comparable ? {
      acceptOnlyDomains: accept.afterDomains.filter(domain => !reject.afterDomains.includes(domain)),
      rejectOnlyDomains: reject.afterDomains.filter(domain => !accept.afterDomains.includes(domain)),
      requestDifference: accept.afterRequests - reject.afterRequests,
    } : null,
    limitations: ['Separate fresh browser profiles; runs are sequential and site behavior may vary.', 'Three-second observation after each click; a dismissed control does not prove consent was honored.', 'Webcmd 0.7.8 retains these generated profile directories locally; sessions are closed after each run.'],
  };
}
module.exports = { compareConsent };
