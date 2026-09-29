const test = require("node:test");
const assert = require("node:assert/strict");
const { requestGeminiJson } = require("./gemini-request");

function fixture(statuses, { retryAfter = null, elapsed = 0, budgetMs = 25000 } = {}) {
  let time = 0;
  const calls = [], waits = [];
  return { calls, waits, options: {
    budgetMs, now: () => time,
    sleep: async ms => { waits.push(ms); time += ms; },
    fetchImpl: async (_url, init) => {
      calls.push(init); time += elapsed;
      const status = statuses.shift();
      assert(status, "Unexpected extra request");
      return {
        ok: status === 200, status, headers: { get: () => retryAfter },
        json: async () => status === 200 ? { candidates: ["explanation"] } : { error: { message: "Provider error" } },
      };
    },
  } };
}
const request = options => requestGeminiJson("https://example.test/gemini", { method: "POST", body: "same evidence" }, options);

test("503 retries once with the same payload and deadline signal, then returns the explanation", async () => {
  const f = fixture([503, 200]);
  assert.deepEqual(await request(f.options), { candidates: ["explanation"] });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body, f.calls[1].body);
  assert.equal(f.calls[0].signal, f.calls[1].signal);
  assert.deepEqual(f.waits, [1000]);
});

test("persistent overload stops after two attempts and preserves the provider error", async () => {
  const f = fixture([503, 503]);
  await assert.rejects(request(f.options), { code: "GEMINI_HTTP_503", message: "Gemini API returned HTTP 503: Provider error" });
  assert.equal(f.calls.length, 2);
});

test("authentication, bad requests, and quota errors are not retried", async () => {
  for (const status of [400, 401, 403, 404, 429]) {
    const f = fixture([status]);
    await assert.rejects(request(f.options), { code: `GEMINI_HTTP_${status}` });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.waits, []);
  }
});

test("Retry-After is respected, but cannot extend the remaining budget", async () => {
  for (const retryAfter of ["2", "Thu, 01 Jan 1970 00:00:02 GMT"]) {
    const f = fixture([503, 200], { retryAfter });
    await request(f.options);
    assert.deepEqual(f.waits, [2000]);
  }
  for (const options of [{ retryAfter: "30" }, { elapsed: 24000 }]) {
    const f = fixture([503], options);
    await assert.rejects(request(f.options), { code: "GEMINI_HTTP_503" });
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.waits, []);
  }
});

test("the second attempt uses the original deadline rather than a fresh timeout", async () => {
  const f = fixture([503, 200], { elapsed: 13000 });
  await assert.rejects(request(f.options), { code: "GEMINI_TIMEOUT" });
  assert.equal(f.calls.length, 2);
});

test("the abort deadline covers a stalled response body", async () => {
  let signal;
  await assert.rejects(request({ budgetMs: 20, fetchImpl: async (_url, init) => {
    signal = init.signal;
    return { ok: true, json: () => new Promise((_, reject) => {
      const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    }) };
  } }), { code: "GEMINI_TIMEOUT" });
  assert.equal(signal.aborted, true);
});

test("non-JSON 503 errors can retry but malformed successful responses cannot", async () => {
  const f = fixture([200]);
  let calls = 0;
  const fetchImpl = async (...args) => ++calls === 1
    ? { ok: false, status: 503, json: async () => { throw new SyntaxError("HTML response"); } }
    : f.options.fetchImpl(...args);
  await request({ ...f.options, fetchImpl });
  assert.equal(calls, 2);
  await assert.rejects(request({ ...f.options, fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError("bad JSON"); } }) }), SyntaxError);
});
