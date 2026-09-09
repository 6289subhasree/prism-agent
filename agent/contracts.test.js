const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WORKFLOW_SCHEMA_VERSION,
  AGENT_RESULT_SCHEMA_VERSION,
  validateAgentResult,
  validateWorkflowEvent,
} = require("./contracts");

const investigationId = "8f4ddad6-e6bb-47de-a4cb-22c5c8c67588";
const timestamp = "2026-08-30T12:00:00.000Z";

test("workflow event contract accepts a sequenced agent event", () => {
  const event = validateWorkflowEvent({
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    investigationId,
    sequence: 1,
    type: "agent.started",
    at: timestamp,
    agentId: "baseline-runtime",
  });
  assert.equal(event.sequence, 1);
});

test("workflow event contract rejects unknown fields", () => {
  assert.throws(() => validateWorkflowEvent({
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    investigationId,
    sequence: 0,
    type: "workflow.started",
    at: timestamp,
    leakedSecret: "must-not-pass",
  }));
});

test("agent result contract applies empty provenance collections", () => {
  const result = validateAgentResult({
    schemaVersion: AGENT_RESULT_SCHEMA_VERSION,
    investigationId,
    agentId: "baseline-runtime",
    status: "completed",
    startedAt: timestamp,
    completedAt: timestamp,
  });
  assert.deepEqual(result.evidenceRefs, []);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.warnings, []);
});
