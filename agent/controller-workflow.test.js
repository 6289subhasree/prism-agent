const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { scoreEvidence } = require('../evidence/scorer');

function controllerFixture(deep, requestGeminiJson, expireBrowserBudget = false) {
  let elapsed = 0;
  const testDate = class extends Date { static now() { return Date.now() + elapsed; } };
  const calls = [];
  const network = domains => ({ requestsByHostname: [{ hostname: 'example.com', count: 4 - domains.length }, ...domains.map(hostname => ({ hostname, count: 1 }))], requestSamples: [] });
  const initial = { finalUrl: 'https://example.com', network: network(deep ? ['a.test', 'b.test'] : []), forms: { count: 0, sensitiveFieldCount: 0, items: [] } };
  const execute = (_command, args, options) => {
    assert(options.timeout > 0);
    if (args.includes('--version')) return '0.7.8';
    if (args.includes('doctor')) return JSON.stringify({ binary: { installed: true }, connectivity: { ok: true } });
    if (args.includes('create')) { calls.push('create'); return JSON.stringify({ session: 'owned-session' }); }
    if (args.includes('close')) { calls.push('close'); assert.equal(options.timeout, 5000); if (expireBrowserBudget) elapsed += 90001; return '{}'; }
    assert.equal(args[args.indexOf('--session') + 1], 'owned-session');
    const source = fs.readFileSync(args[args.indexOf('--file') + 1], 'utf8');
    if (source.includes('bannerCount')) {
      calls.push('consent');
      return JSON.stringify({ result: { observedAt: new Date().toISOString(), pageUrl: 'https://example.com', bannerCount: 0, controls: [], scope: 'top-level-document' } });
    }
    if (calls.includes('initial')) { calls.push('deep'); return JSON.stringify({ result: { finalUrl: 'https://example.com', network: network(['c.test']), continuedExistingPage: true } }); }
    calls.push('initial'); return JSON.stringify({ result: initial });
  };
  const filename = path.join(__dirname, 'controller.js');
  const realRequire = createRequire(filename);
  const load = Object.assign(name => name === 'child_process' ? { execFileSync: execute }
    : name === './gemini-request' && requestGeminiJson ? { requestGeminiJson } : realRequire(name), { resolve: realRequire.resolve });
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: load, module, __dirname, URL, Date: testDate, console: { log() {}, error() {} },
    process: { env: requestGeminiJson ? { GEMINI_API_KEY: 'test-key' } : {}, execPath: process.execPath, platform: process.platform },
  });
  return { investigate: module.exports.investigate, calls };
}

test('controller adapters retain initial/deeper evidence, session cleanup, and deterministic scores', async () => {
  for (const deep of [false, true]) {
    const f = controllerFixture(deep);
    const events = [];
    const report = await f.investigate('https://example.com', { onEvent: event => events.push(event) });
    assert.deepEqual(f.calls, deep ? ['create', 'initial', 'consent', 'deep', 'close'] : ['create', 'initial', 'consent', 'close']);
    assert.equal(report.agentLoop.phase2Ran, deep);
    assert.equal(report.agentLoop.investigationPhases.length, deep ? 2 : 1);
    assert.equal(report.evidence.network.totalRequests, deep ? 8 : 4);
    assert.equal(report.evidence.network.classification.referenceDomain, 'example.com');
    assert.equal(report.evidence.network.requestsByHostname.reduce((sum, host) => sum + host.count, 0), deep ? 8 : 4);
    assert.deepEqual(report.scoring, scoreEvidence(report.evidence));
    assert.equal(report.workflow.status, 'completed');
    assert.equal(report.workflow.agents[2].status, 'skipped');
    assert.equal(report.workflow.agents[3].status, 'skipped');
    assert.equal(events.at(-1).type, 'workflow.completed');
  }
});

test('controller sends the constrained explanation through the bounded request helper', async () => {
  let requests = 0;
  const explanation = { reasoning: 'Observed evidence', evidenceBullets: [], dataCollectionFindings: [], findings: [] };
  const f = controllerFixture(false, async (url, init, options) => {
    requests++;
    assert.match(url, /:generateContent\?key=test-key$/);
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.match(body.contents[0].parts[0].text, /Deterministic scoring/);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(body.generationConfig.responseSchema.required, ['evidenceBullets', 'reasoning', 'dataCollectionFindings', 'findings']);
    assert(options.budgetMs > 0 && options.budgetMs === 45000);
    return { candidates: [{ content: { parts: [{ text: JSON.stringify(explanation) }] } }] };
  });
  const report = await f.investigate('https://example.com');
  assert.equal(requests, 1);
  assert.equal(report.workflow.agents[2].status, 'completed');
  assert.deepEqual(JSON.parse(JSON.stringify(report.explanation)), explanation);
});


test('browser budget exhaustion during cleanup does not consume the explanation allowance', async () => {
  let called = false;
  const f = controllerFixture(false, async (_url, _init, options) => {
    called = true;
    assert.equal(options.budgetMs, 45000);
    return { candidates: [{ content: { parts: [{ text: JSON.stringify({ reasoning: 'Explained', evidenceBullets: [], findings: [], dataCollectionFindings: [] }) }] } }] };
  }, true);
  const report = await f.investigate('https://example.com');
  assert.equal(called, true);
  assert.equal(report.workflow.agents[2].status, 'completed');
});
