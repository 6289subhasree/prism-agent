const test = require("node:test");
const assert = require("node:assert/strict");
const { geminiConfig } = require("./gemini-config");
const { explanationEvidence } = require("./explanation-evidence");
const { checkGemini } = require("../scripts/prism-gemini");

test("Gemini configuration has bounded independent timeouts and safe model IDs", () => {
  assert.deepEqual(geminiConfig({}), { model: "gemini-3.7-flash", timeoutMs: 45000 });
  assert.deepEqual(geminiConfig({ GEMINI_MODEL: "test-model", PRISM_GEMINI_TIMEOUT_MS: "60000" }), { model: "test-model", timeoutMs: 60000 });
  for (const value of ["0", "-1", "Infinity", "60001", "1.5", "invalid"]) assert.throws(() => geminiConfig({ PRISM_GEMINI_TIMEOUT_MS: value }), { code: "GEMINI_CONFIG" });
  assert.throws(() => geminiConfig({ GEMINI_MODEL: "models/test?key=bad" }), { code: "GEMINI_CONFIG" });
});

test("explanation evidence preserves totals, bounds lists and omits raw request samples", () => {
  const evidence = {
    network: { totalRequests: 999, thirdPartyRequests: 90, uniqueThirdPartyDomains: 50, domains: Array.from({ length: 50 }, (_, i) => `${i}.test`), sampleThirdPartyRequests: [{ url: "https://test/?token=secret" }] },
    forms: { count: 30, sensitiveFieldCount: 30, items: Array.from({ length: 30 }, () => ({ actionKind: "script-handler", externalDestination: false, inputs: [{ type: "email", name: "secret-name" }] })) },
  };
  const before = structuredClone(evidence), compact = explanationEvidence(evidence);
  assert.deepEqual(evidence, before);
  assert.equal(compact.network.totalRequests, 999);
  assert.equal(compact.network.domains.length, 40);
  assert.equal(compact.forms.items.length, 20);
  assert.equal(compact.omittedDetails.forms, 10);
  assert.equal(compact.omittedDetails.networkDomains, 10);
  assert(!JSON.stringify(compact).includes("secret"));
});

test("Gemini probe uses configured model and key without printing secrets or invoking a browser", async () => {
  const logs = [];
  const ok = await checkGemini({ env: { GEMINI_API_KEY: "secret-key", GEMINI_MODEL: "test-model" }, log: line => logs.push(line), request: async (url, init, options) => {
    assert.match(url, /models\/test-model:generateContent/);
    assert.equal(options.budgetMs, 45000);
    assert.equal(JSON.parse(init.body).generationConfig.responseMimeType, "application/json");
    return { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] };
  } });
  assert.equal(ok, true);
  assert(!logs.join(" ").includes("secret-key"));
});

test("Gemini probe reports missing key, timeout and unavailable model without leaking credentials", async () => {
  let called = false;
  assert.equal(await checkGemini({ env: {}, log() {}, request: () => { called = true; } }), false);
  assert.equal(called, false);
  for (const code of ["GEMINI_TIMEOUT", "GEMINI_HTTP_404"]) {
    const logs = [];
    assert.equal(await checkGemini({ env: { GEMINI_API_KEY: "private-key" }, log: line => logs.push(line), request: () => { throw Object.assign(new Error("provider private-key"), { code }); } }), false);
    assert(!logs.join(" ").includes("private-key"));
    assert(logs.join(" ").includes(code));
    assert(logs.some(line => line.startsWith("Action:")));
  }
});
