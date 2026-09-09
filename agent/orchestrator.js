const { randomUUID } = require("node:crypto");
const {
  WORKFLOW_SCHEMA_VERSION,
  AGENT_RESULT_SCHEMA_VERSION,
  validateAgentResult,
  validateWorkflowEvent,
  validateWorkflowSummary,
} = require("./contracts");

const BASELINE_AGENT_ID = "baseline-runtime";

function normalizeError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "INVESTIGATION_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}

async function orchestrateInvestigation(targetUrl, options) {
  if (typeof options?.execute !== "function") {
    throw new TypeError("orchestrateInvestigation requires an execute function");
  }

  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;
  const onEvent = options.onEvent || (() => {});
  const investigationId = idFactory();
  const startedAt = now().toISOString();
  let sequence = 0;

  const emit = (event) => {
    const validated = validateWorkflowEvent({
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      investigationId,
      sequence: sequence++,
      at: now().toISOString(),
      ...event,
    });
    onEvent(validated);
    return validated;
  };

  emit({ type: "workflow.started", detail: `Investigation started for ${targetUrl}` });
  const agentStartedAt = now().toISOString();
  emit({ type: "agent.started", agentId: BASELINE_AGENT_ID, detail: "Running the existing PRISM investigation loop" });

  try {
    const report = await options.execute(targetUrl);
    const agentResult = validateAgentResult({
      schemaVersion: AGENT_RESULT_SCHEMA_VERSION,
      investigationId,
      agentId: BASELINE_AGENT_ID,
      status: "completed",
      startedAt: agentStartedAt,
      completedAt: now().toISOString(),
      observations: {
        reportRef: "root",
        phaseCount: report?.agentLoop?.investigationPhases?.length || 0,
      },
      evidenceRefs: ["report.evidence"],
      actions: report?.agentLoop?.investigationPhases?.flatMap((phase) => phase.actions || []) || [],
      warnings: report?.explanation?.status === "unavailable"
        ? ["Optional Gemini explanation was unavailable"]
        : [],
    });
    emit({ type: "agent.completed", agentId: BASELINE_AGENT_ID, detail: "Baseline runtime investigation completed" });

    const workflow = validateWorkflowSummary({
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      investigationId,
      mode: "single-agent-compatibility",
      status: "completed",
      startedAt,
      completedAt: now().toISOString(),
      agents: [agentResult],
    });
    emit({ type: "workflow.completed", detail: "Investigation workflow completed" });
    return { ...report, workflow };
  } catch (error) {
    const normalized = normalizeError(error);
    emit({ type: "agent.failed", agentId: BASELINE_AGENT_ID, error: normalized });
    emit({ type: "workflow.failed", error: normalized });
    throw error;
  }
}

module.exports = {
  BASELINE_AGENT_ID,
  orchestrateInvestigation,
  _testing: { normalizeError },
};
