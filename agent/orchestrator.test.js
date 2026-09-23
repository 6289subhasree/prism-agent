const test = require("node:test");
const assert = require("node:assert/strict");
const { orchestrateInvestigation } = require("./orchestrator");
const { scoreEvidence } = require("../evidence/scorer");
const { WORKFLOW_PREFIX, parseWorkflowLine } = require("./progress");

function fixture(overrides = {}) {
  let tick = 0;
  const events = [], calls = [];
  const baseline = {
    investigatedUrl: "https://example.com", humanApprovalRequired: true,
    evidence: { network: { domains: ["analytics.example.net"] }, forms: { items: [] } },
    agentLoop: { plannerDecision: { needed: false, reason: "Sufficient evidence" }, investigationPhases: [{ phase: "initial", actions: ["navigate"] }], phase2Ran: false },
    consent: { status: "not-observed", controls: [] }, runtimeWarnings: [],
  };
  return { events, calls, baseline, options: {
    now: () => new Date(Date.UTC(2026, 8, 23, 12, 0, tick++)),
    onEvent: event => events.push(event),
    collectEvidence: async url => { calls.push("browser"); assert.equal(url, baseline.investigatedUrl); return baseline; },
    scoreEvidence: evidence => { calls.push("score"); assert.equal(evidence, baseline.evidence); return scoreEvidence(evidence); },
    explain: async (evidence, score, decision) => {
      calls.push("explain"); assert.equal(evidence, baseline.evidence); assert.deepEqual(score, scoreEvidence(evidence)); assert.equal(decision, baseline.agentLoop.plannerDecision);
      return { reasoning: "Observed evidence explained" };
    },
    comparisonEnabled: true,
    compareConsent: async () => { calls.push("compare"); return { status: "completed", runs: [] }; },
    ...overrides,
  } };
}
const run = f => orchestrateInvestigation("https://example.com", f.options);

test("stages pass evidence and deterministic score in order and preserve report fields", async () => {
  const f = fixture(); const report = await run(f);
  assert.deepEqual(f.calls, ["browser", "score", "explain", "compare"]);
  assert.equal(report.evidence, f.baseline.evidence);
  assert.equal(report.agentLoop, f.baseline.agentLoop);
  assert.equal(report.consent, f.baseline.consent);
  assert.equal(report.humanApprovalRequired, true);
  assert.deepEqual(report.scoring, scoreEvidence(f.baseline.evidence));
  assert.equal(report.workflow.mode, "staged-workflow");
  assert.equal(report.workflow.status, "completed");
  assert.equal(report.workflow.agents.length, 4);
  assert.deepEqual(report.workflow.agents.map(a => a.status), Array(4).fill("completed"));
  assert.deepEqual(report.workflow.events, f.events);
  assert.deepEqual(f.events.map(e => e.sequence), f.events.map((_, i) => i));
  assert(f.events.every(e => e.investigationId === report.workflow.investigationId));
});

test("Gemini failure retains scoring and allows consent comparison", async () => {
  const f = fixture({ explain: async () => { throw new Error("Gemini timed out"); } });
  const report = await run(f);
  assert.equal(report.workflow.status, "partial");
  assert.equal(report.explanation.status, "unavailable");
  assert.deepEqual(report.scoring, scoreEvidence(f.baseline.evidence));
  assert.equal(report.consentComparison.status, "completed");
  assert.equal(report.workflow.agents[2].status, "failed");
  assert.equal(report.workflow.agents[2].error.message, "Gemini timed out");
});

test("disabled optional stages are skipped and never invoked", async () => {
  const f = fixture({ explanationEnabled: false, comparisonEnabled: false });
  const report = await run(f);
  assert.deepEqual(f.calls, ["browser", "score"]);
  assert.equal(report.workflow.status, "completed");
  assert.deepEqual(report.workflow.agents.map(a => a.status), ["completed", "completed", "skipped", "skipped"]);
  assert.equal(report.consentComparison.status, "disabled");
});

test("partial comparison retains its successful run and marks workflow partial", async () => {
  const comparison = { status: "partial", comparison: null, runs: [{ choice: "reject", status: "failed", reason: "ambiguous" }, { choice: "accept", status: "observed", afterRequests: 3 }] };
  const f = fixture({ compareConsent: async () => comparison });
  const report = await run(f);
  assert.equal(report.consentComparison, comparison);
  assert.equal(report.workflow.status, "partial");
  assert.equal(report.workflow.agents[3].status, "partial");
  assert(f.events.some(e => e.type === "agent.partial"));
});

test("unexpected comparison failure retains baseline report", async () => {
  const f = fixture({ compareConsent: async () => { throw new Error("profile unavailable"); } });
  const report = await run(f);
  assert.equal(report.consentComparison.error, "profile unavailable");
  assert.equal(report.consentComparison.comparison, null);
  assert.equal(report.workflow.agents[3].status, "failed");
  assert.equal(report.evidence, f.baseline.evidence);
});

test("required browser or score failure stops dependent stages and preserves original error", async () => {
  for (const adapter of ["collectEvidence", "scoreEvidence"]) {
    const failure = Object.assign(new Error("required stage failed"), { code: "REQUIRED_FAILURE" });
    const f = fixture({ [adapter]: () => { throw failure; } });
    await assert.rejects(run(f), error => error === failure);
    assert(!f.calls.includes("explain")); assert(!f.calls.includes("compare"));
    assert.equal(f.events.at(-1).type, "workflow.failed");
    assert.equal(f.events.at(-2).type, "agent.failed");
    assert.equal(f.events.at(-1).error.code, "REQUIRED_FAILURE");
  }
});

test("consent detection and session cleanup warnings produce a partial browser stage", async () => {
  const f = fixture();
  f.baseline.consent = { status: "unavailable", error: "inspection timeout" };
  f.baseline.runtimeWarnings = ["Session close failed"];
  const report = await run(f);
  assert.equal(report.workflow.agents[0].status, "partial");
  assert.deepEqual(report.workflow.agents[0].warnings, ["Session close failed", "inspection timeout"]);
  assert.equal(report.workflow.status, "partial");
});

test("broken progress consumer cannot discard investigation results", async () => {
  const f = fixture({ onEvent: () => { throw new Error("disconnected consumer"); } });
  const report = await run(f);
  assert.equal(report.workflow.status, "completed");
  assert.equal(report.workflow.events.at(-1).type, "workflow.completed");
});

test("validated progress lines round-trip and malformed or ordinary logs are ignored", async () => {
  const report = await run(fixture());
  for (const event of report.workflow.events) assert.deepEqual(parseWorkflowLine(WORKFLOW_PREFIX + JSON.stringify(event)), event);
  assert.equal(parseWorkflowLine("[OBSERVE] normal log"), null);
  assert.equal(parseWorkflowLine(WORKFLOW_PREFIX + "{"), null);
  assert.equal(parseWorkflowLine(WORKFLOW_PREFIX + JSON.stringify({ type: "agent.completed" })), null);
  assert.equal(parseWorkflowLine(WORKFLOW_PREFIX + JSON.stringify({ ...report.workflow.events[0], unexpected: true })), null);
});

test("UI distinguishes skipped and failed stages and stops pending rows after required failure", async () => {
  const { workflowRows } = await import("../src/workflow.mjs");
  const f = fixture({ explanationEnabled: false });
  const report = await run(f);
  const rows = workflowRows(report.workflow.events);
  assert.equal(rows[2].status, "skipped");
  assert.equal(rows[0].status, "completed");
  assert(rows[0].durationSeconds > 0);
  const failed = fixture({ collectEvidence: () => { throw new Error("browser failed"); } });
  await assert.rejects(run(failed));
  const failedRows = workflowRows(failed.events);
  assert.equal(failedRows[0].status, "failed");
  assert.deepEqual(failedRows.slice(1).map(r => r.status), Array(3).fill("not-run"));
});
