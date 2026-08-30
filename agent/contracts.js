const { z } = require("zod");

const WORKFLOW_SCHEMA_VERSION = "prism.workflow.v1";
const AGENT_RESULT_SCHEMA_VERSION = "prism.agent-result.v1";

const isoTimestamp = z.string().datetime({ offset: true });

const workflowEventSchema = z.object({
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  investigationId: z.string().uuid(),
  sequence: z.number().int().nonnegative(),
  type: z.enum([
    "workflow.started",
    "workflow.completed",
    "workflow.failed",
    "agent.started",
    "agent.completed",
    "agent.failed",
    "agent.skipped",
  ]),
  at: isoTimestamp,
  agentId: z.string().min(1).optional(),
  detail: z.string().min(1).optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).optional(),
}).strict();

const agentResultSchema = z.object({
  schemaVersion: z.literal(AGENT_RESULT_SCHEMA_VERSION),
  investigationId: z.string().uuid(),
  agentId: z.string().min(1),
  status: z.enum(["completed", "partial", "failed", "skipped"]),
  startedAt: isoTimestamp,
  completedAt: isoTimestamp,
  sessionId: z.string().min(1).optional(),
  observations: z.unknown().optional(),
  evidenceRefs: z.array(z.string().min(1)).default([]),
  actions: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string().min(1)).default([]),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).optional(),
}).strict();

const workflowSummarySchema = z.object({
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  investigationId: z.string().uuid(),
  mode: z.enum(["single-agent-compatibility", "multi-agent"]),
  status: z.enum(["completed", "partial", "failed"]),
  startedAt: isoTimestamp,
  completedAt: isoTimestamp,
  agents: z.array(agentResultSchema),
}).strict();

function validateWorkflowEvent(value) {
  return workflowEventSchema.parse(value);
}

function validateAgentResult(value) {
  return agentResultSchema.parse(value);
}

function validateWorkflowSummary(value) {
  return workflowSummarySchema.parse(value);
}

module.exports = {
  WORKFLOW_SCHEMA_VERSION,
  AGENT_RESULT_SCHEMA_VERSION,
  workflowEventSchema,
  agentResultSchema,
  workflowSummarySchema,
  validateWorkflowEvent,
  validateAgentResult,
  validateWorkflowSummary,
};
