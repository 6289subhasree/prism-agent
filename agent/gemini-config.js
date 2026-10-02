const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";

function geminiConfig(env = process.env) {
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const timeoutMs = Number(env.PRISM_GEMINI_TIMEOUT_MS || 45000);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(model)) {
    throw Object.assign(new Error("GEMINI_MODEL must contain a model ID, without a URL or models/ prefix"), { code: "GEMINI_CONFIG" });
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw Object.assign(new Error("PRISM_GEMINI_TIMEOUT_MS must be an integer from 1000 to 60000"), { code: "GEMINI_CONFIG" });
  }
  return { model, timeoutMs };
}
module.exports = { geminiConfig };
