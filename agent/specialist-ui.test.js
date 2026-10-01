const test = require("node:test");
const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { analyzeNetwork, verifyFindings } = require("./specialists");

test("report evidence pointers preserve zero values and reject invalid or inherited paths", async () => {
  const { evidenceAt } = await import("../src/finding-evidence.mjs");
  assert.equal(evidenceAt({ count: 0 }, "/count"), 0);
  assert.equal(evidenceAt({ "a/b": { "~key": 4 } }, "/a~1b/~0key"), 4);
  for (const pointer of ["/toString", "/__proto__", "/constructor", "/missing", "/a~2", "wrong", null]) {
    assert.equal(evidenceAt({}, pointer), undefined);
  }
});

test("findings render with accessible evidence details, escaped source data, and failure states", async () => {
  const { createServer } = await import("vite");
  const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom" });
  try {
    const { SpecialistFindings } = await server.ssrLoadModule("/src/SpecialistFindings.jsx");
    const report = { evidence: { network: { totalRequests: 1, thirdPartyRequests: 1, uniqueThirdPartyDomains: 1,
      requestsByHostname: [{ hostname: "analytics.example.net", count: 1, thirdParty: true }],
      sampleThirdPartyRequests: [{ url: "https://example.net/<script>alert(1)</script>" }],
    } } };
    report.specialistFindings = verifyFindings(report, analyzeNetwork(report).findings);
    const render = value => renderToStaticMarkup(createElement(SpecialistFindings, { report: value }));
    const html = render(report);
    assert.match(html, /Findings with evidence/);
    assert.match(html, /1 of 1 captured requests/);
    assert.match(html, /<details><summary>Inspect supporting evidence/);
    assert.match(html, /\/evidence\/network/);
    assert.match(html, /&lt;script&gt;/);
    assert(!html.includes("<script>"));
    assert.equal(render({}), "");
    assert.match(render({ specialistFindings: { findings: [], rejected: [{ id: "network-summary", reason: "Counts disagree" }] } }), /1 finding withheld/);
    assert.match(render({ specialistFindings: { findings: [], error: "Analyzer failed" } }), /Finding verification unavailable: Analyzer failed/);
  } finally {
    await server.close();
  }
});
