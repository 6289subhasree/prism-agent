const { setTimeout: delay } = require("node:timers/promises");

// At most two attempts share one deadline, including response bodies and backoff.
async function requestGeminiJson(url, init, {
  budgetMs, fetchImpl = fetch, now = Date.now,
  sleep = (ms, signal) => delay(ms, undefined, { signal }),
}) {
  const timeoutError = () => Object.assign(
    new Error(`Gemini explanation timed out after ${budgetMs / 1000}s`),
    { code: "GEMINI_TIMEOUT" },
  );
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw timeoutError();
  const deadline = now() + budgetMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (controller.signal.aborted || now() >= deadline) throw timeoutError();
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      let data;
      try { data = await response.json(); }
      catch (error) {
        // An overloaded upstream may send HTML instead of a JSON error body.
        if (!response.ok && error.name === "SyntaxError") data = {};
        else throw error;
      }
      if (controller.signal.aborted || now() >= deadline) throw timeoutError();
      if (response.ok) return data;
      const failure = Object.assign(new Error(
        `Gemini API returned HTTP ${response.status}: ${data?.error?.message || "request failed"}`,
      ), { code: `GEMINI_HTTP_${response.status}` });
      if (response.status !== 503 || attempt === 1) throw failure;

      const retryAfter = response.headers?.get("retry-after");
      const serverDelay = retryAfter == null ? 0 : /^\d+(\.\d+)?$/.test(retryAfter)
        ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now();
      const waitMs = Math.max(1000, Number.isFinite(serverDelay) ? serverDelay : 0);
      // Honor Retry-After and leave at least a second for another response.
      if (waitMs + 1000 >= deadline - now()) throw failure;
      await sleep(waitMs, controller.signal);
    }
  } catch (error) {
    if (controller.signal.aborted || error.name === "AbortError") throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { requestGeminiJson };
