const { randomUUID } = require("node:crypto");
const {
  WORKFLOW_SCHEMA_VERSION, AGENT_RESULT_SCHEMA_VERSION,
  validateAgentResult, validateWorkflowEvent, validateWorkflowSummary,
} = require("./contracts");

function normalizeError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "INVESTIGATION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

// Deterministic stages have explicit inputs and outputs. Only the explanation
// adapter uses an LLM; stage count is not a claim of independent AI agents.
async function orchestrateInvestigation(targetUrl, options) {
  for (const name of ["collectEvidence", "scoreEvidence", "explain"]) {
    if (typeof options?.[name] !== "function") throw new TypeError(`Missing workflow adapter: ${name}`);
  }
  if (options.comparisonEnabled && typeof options.compareConsent !== "function") {
    throw new TypeError("Missing workflow adapter: compareConsent");
  }
  const now = options.now || (() => new Date());
  const investigationId = (options.idFactory || randomUUID)();
  const startedAt = now().toISOString();
  const agents = [], events = [];
  let sequence = 0;
  const emit = event => {
    const validated = validateWorkflowEvent({
      schemaVersion: WORKFLOW_SCHEMA_VERSION, investigationId,
      sequence: sequence++, at: now().toISOString(), ...event,
    });
    events.push(validated);
    // Observability must not interrupt a browser session or discard evidence.
    try { options.onEvent?.(validated); } catch { /* The final report retains events. */ }
  };
  async function stage(agentId, detail, execute, config = {}) {
    const stageStartedAt = now().toISOString();
    if (!config.skip) emit({ type: "agent.started", agentId, detail });
    let value, error, status = config.skip ? "skipped" : "completed";
    try {
      value = config.skip ? config.fallback() : await execute();
      if (!config.skip && config.outcome) status = config.outcome(value);
    } catch (failure) {
      error = normalizeError(failure);
      status = "failed";
      if (!config.optional) {
        agents.push(validateAgentResult({
          schemaVersion: AGENT_RESULT_SCHEMA_VERSION, investigationId, agentId,
          status, startedAt: stageStartedAt, completedAt: now().toISOString(), error,
        }));
        emit({ type: "agent.failed", agentId, error, detail: `${detail}: failed` });
        throw failure;
      }
      value = config.fallback(error);
    }
    agents.push(validateAgentResult({
      schemaVersion: AGENT_RESULT_SCHEMA_VERSION, investigationId, agentId,
      status, startedAt: stageStartedAt, completedAt: now().toISOString(),
      evidenceRefs: status === "failed" || status === "skipped" ? [] : config.refs || [],
      warnings: config.warnings?.(value) || [],
      ...(error ? { error } : {}),
    }));
    const type = status === "skipped" ? "agent.skipped" : status === "failed" ? "agent.failed" : status === "partial" ? "agent.partial" : "agent.completed";
    emit({ type, agentId, detail: config.skip || `${detail}: ${status}`, ...(error ? { error } : {}) });
    return value;
  }
  emit({ type: "workflow.started", detail: "Investigation started" });
  try {
    const baseline = await stage("browser-evidence", "Collecting browser evidence", () => options.collectEvidence(targetUrl), {
      refs: ["report.evidence", "report.consent"],
      outcome: value => value.consent?.status === "unavailable" || value.runtimeWarnings?.length ? "partial" : "completed",
      warnings: value => [...(value.runtimeWarnings || []), ...(value.consent?.status === "unavailable" ? [value.consent.error || "Consent inspection unavailable"] : [])],
    });
    const scoring = await stage("deterministic-score", "Scoring observed evidence", () => options.scoreEvidence(baseline.evidence), { refs: ["report.scoring", "report.evidence"] });
    const explanation = await stage("explanation", "Explaining the evidence", () => options.explain(baseline.evidence, scoring, baseline.agentLoop.plannerDecision), {
      optional: true, skip: options.explanationEnabled === false ? "Gemini is not configured" : null,
      refs: ["report.explanation"],
      outcome: value => value.status === "unavailable" ? "partial" : "completed",
      fallback: () => ({ status: "unavailable", evidenceBullets: [], reasoning: "The optional explanation is unavailable. Observed evidence and deterministic scoring are retained.", dataCollectionFindings: [], findings: [] }),
    });
    const consentComparison = await stage("consent-comparison", "Comparing reject and accept", () => options.compareConsent(targetUrl), {
      optional: true, skip: options.comparisonEnabled ? null : "Consent comparison is disabled",
      refs: ["report.consentComparison"],
      outcome: value => value.status === "completed" ? "completed" : "partial",
      warnings: value => value.runs.flatMap(run => run.warnings || []),
      fallback: error => error ? { status: "partial", runs: [], comparison: null, error: error.message } : { status: "disabled", runs: [] },
    });
    const status = agents.some(agent => ["partial", "failed"].includes(agent.status)) ? "partial" : "completed";
    emit({ type: "workflow.completed", detail: status === "partial" ? "Report ready with some unavailable results" : "Report ready" });
    const workflow = validateWorkflowSummary({
      schemaVersion: WORKFLOW_SCHEMA_VERSION, investigationId, mode: "staged-workflow", status,
      startedAt, completedAt: now().toISOString(), agents, events,
    });
    return { ...baseline, generatedAt: now().toISOString(), scoring, explanation, consentComparison, workflow };
  } catch (error) {
    emit({ type: "workflow.failed", error: normalizeError(error) });
    throw error;
  }
}

module.exports = { orchestrateInvestigation, _testing: { normalizeError } };
