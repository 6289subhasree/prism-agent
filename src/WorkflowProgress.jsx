import { workflowRows } from "./workflow.mjs";

export function WorkflowProgress({ events = [], live = false, status }) {
  if (!events.length) return null;
  return <div className="workflow-progress">
    <div className="workflow-heading"><span>{live ? "INVESTIGATION PROGRESS" : "INVESTIGATION STAGES"}</span>{status === "partial" && <span>Some results unavailable</span>}</div>
    <ol aria-label="Investigation stages" aria-live={live ? "polite" : "off"}>
      {workflowRows(events).map(row => <li key={row.id} className={`workflow-${row.status}`}>
        <div><strong>{row.label}</strong><span>{row.status === "not-run" ? "Not run" : row.status}{row.durationSeconds !== undefined && ` · ${row.durationSeconds.toFixed(1)}s`}</span></div>
        <p>{row.detail}</p>
      </li>)}
    </ol>
  </div>;
}
