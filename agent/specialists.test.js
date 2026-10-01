const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeNetwork, analyzeConsent, verifyFindings, resolveEvidence } = require("./specialists");

function fixture() {
  return {
    evidence: { network: { totalRequests: 12, thirdPartyRequests: 2, uniqueThirdPartyDomains: 1,
      requestsByHostname: [{ hostname: "example.com", count: 10, thirdParty: false }, { hostname: "analytics.example.net", count: 2, thirdParty: true }],
    } },
    consent: { status: "detected", controls: [{ inferredAction: "accept" }, { inferredAction: "reject" }, { inferredAction: "unknown" }] },
    consentComparison: { status: "completed", runs: [
      { choice: "reject", status: "observed", controlDismissed: true, observationMs: 3000, afterRequests: 2 },
      { choice: "accept", status: "observed", controlDismissed: true, observationMs: 3000, afterRequests: 9 },
    ], comparison: { requestDifference: 7 } },
  };
}
const proposals = report => [...analyzeNetwork(report).findings, ...analyzeConsent(report).findings];

test("specialists produce cited findings without mutating evidence or inventing scores", () => {
  const report = fixture(), before = structuredClone(report);
  const verified = verifyFindings(report, proposals(report));
  assert.deepEqual(report, before);
  assert.equal(verified.status, "completed");
  assert.equal(verified.findings.length, 3);
  assert.equal(verified.findings[1].basis, "inferred");
  assert.match(verified.findings[2].text, /\+7 third-party requests/);
  assert(verified.findings.every(f => !Object.hasOwn(f, "score")));
  for (const finding of verified.findings) for (const ref of finding.evidenceRefs) assert.notEqual(resolveEvidence(report, ref), undefined);
});

test("verifier rejects tampered counts, basis, source, references and unsolicited prose", () => {
  const report = fixture(), original = proposals(report)[0];
  for (const patch of [
    { values: { ...original.values, thirdPartyRequests: 9 } }, { basis: "inferred" },
    { specialist: "consent" }, { evidenceRefs: ["/consent/status"] },
    { evidenceRefs: ["/absent"] }, { text: "This site is unsafe" }, { claim: "compliance-verdict" },
  ]) {
    const result = verifyFindings(report, [{ ...original, ...patch }]);
    assert.equal(result.findings.length, 0);
    assert.equal(result.rejected.length, 1);
  }
});

test("network verifier checks underlying rows even if the proposed summary matches totals", () => {
  const report = fixture(), candidate = analyzeNetwork(report).findings[0];
  report.evidence.network.requestsByHostname[1].count = 8;
  assert.match(verifyFindings(report, [candidate]).rejected[0].reason, /totals disagree/);
});

test("partial, missing, duplicate or undismissed consent observations cannot support a difference", () => {
  for (const mutate of [
    report => { report.consentComparison.status = "partial"; },
    report => { report.consentComparison.runs.pop(); },
    report => { report.consentComparison.runs[0].controlDismissed = false; },
    report => { report.consentComparison.runs[0].observationMs = 2000; },
    report => { report.consentComparison.runs[0].choice = "accept"; },
    report => { report.consentComparison.runs[0].afterRequests = 5; },
  ]) {
    const report = fixture();
    const candidate = analyzeConsent(report).findings.find(f => f.claim === "consent-request-difference");
    mutate(report);
    assert.equal(verifyFindings(report, [candidate]).findings.length, 0);
  }
});

test("zero and negative consent differences are preserved without claiming causation", () => {
  for (const afterRequests of [2, 0]) {
    const report = fixture();
    report.consentComparison.runs[1].afterRequests = afterRequests;
    report.consentComparison.comparison.requestDifference = afterRequests - 2;
    const verified = verifyFindings(report, analyzeConsent(report).findings);
    assert.equal(verified.status, "completed");
    assert.match(verified.findings[1].text, /do not establish causation/);
    assert.equal(verified.findings[1].values.difference, afterRequests - 2);
  }
});

test("unavailable evidence produces warnings rather than zero-count findings", () => {
  assert.equal(analyzeNetwork({}).findings.length, 0);
  const result = analyzeConsent({ consent: { status: "unavailable" } });
  assert.equal(result.findings.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.equal(analyzeConsent({ consent: { status: "not-observed" } }).findings.length, 0);
});

test("invalid candidates are withheld individually while supported findings survive", () => {
  const report = fixture(), candidates = proposals(report);
  const result = verifyFindings(report, [null, candidates[0], candidates[0], candidates[1]]);
  assert.equal(result.findings.length, 2);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.status, "partial");
});

test("evidence pointers cannot resolve inherited properties and support escaped keys", () => {
  assert.throws(() => resolveEvidence({}, "/toString"), /Missing evidence/);
  assert.throws(() => resolveEvidence({}, "/__proto__"), /Missing evidence/);
  assert.throws(() => resolveEvidence({}, "/bad~2key"), /Invalid JSON pointer/);
  assert.equal(resolveEvidence({ "a/b": { "~key": 3 } }, "/a~1b/~0key"), 3);
});
