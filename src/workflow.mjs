export const WORKFLOW_STAGES = [
  { id: "browser-evidence", label: "Browser evidence" },
  { id: "deterministic-score", label: "Deterministic score" },
  { id: "explanation", label: "Gemini explanation" },
  { id: "consent-comparison", label: "Consent comparison" },
];

export function workflowRows(events = []) {
  const rows = WORKFLOW_STAGES.map(stage => ({ ...stage, status: "pending", detail: "Waiting" }));
  const states = { started: "running", completed: "completed", partial: "partial", failed: "failed", skipped: "skipped" };
  const ordered = [...events].sort((a, b) => a.sequence - b.sequence);
  for (const event of ordered) {
    const row = rows.find(stage => stage.id === event.agentId);
    if (!row || !event.type.startsWith("agent.")) continue;
    const status = states[event.type.slice(6)];
    if (!status) continue;
    row.status = status;
    row.detail = event.error?.message || event.detail || status;
    if (status === "running") row.startedAt = event.at;
    else if (row.startedAt) row.durationSeconds = Math.max(0, (Date.parse(event.at) - Date.parse(row.startedAt)) / 1000);
  }
  if (ordered.some(event => event.type === "workflow.failed")) {
    for (const row of rows) if (row.status === "pending") { row.status = "not-run"; row.detail = "Investigation stopped before this stage"; }
  }
  return rows;
}
