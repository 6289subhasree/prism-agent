const { randomUUID } = require("node:crypto");

// One manager belongs to one investigation. Only sessions created by this
// manager may be closed; cleanup has its own budget after a run times out.
function createSessionManager({ run, parseJson, remaining, onWarning = () => {}, closeTimeoutMs = 5000 }) {
  const active = new Set();
  const warnings = [];
  if (![run, parseJson, remaining].every((value) => typeof value === "function")) {
    throw new TypeError("Session manager requires run, parseJson and remaining functions");
  }
  if (!Number.isFinite(closeTimeoutMs) || closeTimeoutMs <= 0) {
    throw new TypeError("Session cleanup timeout must be positive");
  }

  function open() {
    const budget = remaining("session create");
    if (!Number.isFinite(budget) || budget <= 0) throw new Error("No time left to create a browser session");
    const result = parseJson(run(["session", "create", `prism-${randomUUID()}`, "-f", "json"], budget), "session create");
    const id = result?.session || result?.id || result?.sessionId;
    if (typeof id !== "string" || !id.trim()) throw new Error("Webcmd did not return a valid session ID");
    if (active.has(id)) throw new Error("Webcmd returned an already active session ID");
    active.add(id);
    return id;
  }

  function close(id) {
    if (!active.has(id)) return false;
    try {
      run(["session", "close", id], closeTimeoutMs);
      active.delete(id);
      return true;
    } catch (error) {
      const warning = `Failed to close browser session ${id}: ${error.message || String(error)}`;
      warnings.push(warning);
      // Reporting must never mask the investigation's original failure.
      try { onWarning(warning); } catch {}
      return false;
    }
  }

  async function withSession(execute) {
    if (typeof execute !== "function") throw new TypeError("Session callback must be a function");
    const id = open();
    try { return await execute(id); }
    finally { close(id); }
  }

  return {
    open, close, withSession,
    closeAll() { for (const id of [...active]) close(id); },
    get activeSessionIds() { return [...active]; },
    get warnings() { return [...warnings]; },
  };
}

module.exports = { createSessionManager };
