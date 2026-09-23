const { workflowEventSchema } = require("./contracts");
const WORKFLOW_PREFIX = "[PRISM_WORKFLOW] ";

function parseWorkflowLine(line) {
  if (!line.startsWith(WORKFLOW_PREFIX)) return null;
  try {
    const result = workflowEventSchema.safeParse(JSON.parse(line.slice(WORKFLOW_PREFIX.length)));
    return result.success ? result.data : null;
  } catch { return null; }
}
module.exports = { WORKFLOW_PREFIX, parseWorkflowLine };
