const test = require("node:test");
const assert = require("node:assert/strict");
const { orchestrateInvestigation } = require("./orchestrator");

const investigationId = "8f4ddad6-e6bb-47de-a4cb-22c5c8c67588";

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 30, 12, 0, tick++));
}

test("orchestrator preserves the report and attaches validated workflow metadata", async () => {
  const events = [];
  const report = await orchestrateInvestigation("https://example.com", {
    idFactory: () => investigationId,
    now: clock(),
    onEvent: (event) => events.push(event),
    execute: async () => ({
      investigatedUrl: "https://example.com",
      agentLoop: { investigationPhases: [{ actions: ["navigate", "capture_network"] }] },
      evidence: { network: {}, forms: {} },
      scoring: { score: 0 },
      explanation: {},
    }),
  });

  assert.equal(report.investigatedUrl, "https://example.com");
  assert.equal(report.workflow.investigationId, investigationId);
  assert.equal(report.workflow.mode, "single-agent-compatibility");
  assert.equal(report.workflow.agents[0].status, "completed");
  assert.deepEqual(events.map((event) => event.type), [
    "workflow.started",
    "agent.started",
    "agent.completed",
    "workflow.completed",
  ]);
  assert.deepEqual(events.map((event) => event.sequence), [0, 1, 2, 3]);
});

test("orchestrator emits agent and workflow failures without replacing the original error", async () => {
  const events = [];
  const failure = Object.assign(new Error("browser session failed"), { code: "WEBCMD_SESSION_FAILED" });

  await assert.rejects(
    orchestrateInvestigation("https://example.com", {
      idFactory: () => investigationId,
      now: clock(),
      onEvent: (event) => events.push(event),
      execute: async () => { throw failure; },
    }),
    (error) => error === failure
  );

  assert.deepEqual(events.map((event) => event.type), [
    "workflow.started",
    "agent.started",
    "agent.failed",
    "workflow.failed",
  ]);
  assert.equal(events[2].error.code, "WEBCMD_SESSION_FAILED");
});
