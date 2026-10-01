const test = require("node:test");
const assert = require("node:assert/strict");
const { siteIdentity, isThirdParty, classifyNetwork, classifyEvidence, classifyConsentResult } = require("../evidence/domain-classifier");
const { scoreEvidence } = require("../evidence/scorer");
const counts = entries => entries.map(([hostname, count]) => ({ hostname, count }));

test("same-site subdomains match without confusing unrelated public or private suffix tenants", () => {
  const cases = [
    ["consent.cookiebot.com", "https://www.cookiebot.com", false],
    ["cdn.example.co.uk", "https://www.example.co.uk", false],
    ["other.co.uk", "https://example.co.uk", true],
    ["alice.github.io", "https://bob.github.io", true],
    ["cdn.alice.github.io", "https://alice.github.io", false],
    ["alice.netlify.app", "https://bob.netlify.app", true],
    ["cookiebot.com.evil.com", "https://cookiebot.com", true],
    ["evilcookiebot.com", "https://cookiebot.com", true],
  ];
  for (const [resource, page, expected] of cases) assert.equal(isThirdParty(resource, page), expected, `${resource} vs ${page}`);
});

test("normalization handles case, root dots, international names, IPs and unknown suffixes", () => {
  assert.equal(isThirdParty("CDN.EXAMPLE.COM.", "https://www.example.com"), false);
  assert.equal(isThirdParty("https://bücher.de/a", "https://xn--bcher-kva.de"), false);
  assert.equal(isThirdParty("https://[::1]:9000/a", "http://[::1]:8000"), false);
  assert.equal(isThirdParty("::1", "http://[::1]:8000"), false);
  assert.equal(isThirdParty("127.0.0.2", "http://127.0.0.1"), true);
  assert.equal(isThirdParty("a.unknownsuffix", "https://b.unknownsuffix"), true);
  assert.equal(siteIdentity("javascript:alert(1)"), null);
});

test("Cookiebot subdomains remain in raw counts but no longer inflate third-party scoring", () => {
  const network = classifyNetwork(counts([
    ["www.cookiebot.com", 100], ["consent.cookiebot.com", 5], ["sst.cookiebot.com", 4],
    ["consentcdn.cookiebot.com", 3], ["www.google-analytics.com", 2], ["www.googletagmanager.com", 1],
  ]), "https://www.cookiebot.com/");
  assert.equal(network.totalRequests, 115);
  assert.equal(network.firstPartyRequests, 112);
  assert.equal(network.thirdPartyRequests, 3);
  assert.equal(network.uniqueThirdPartyDomains, 2);
  assert.equal(network.requestsByHostname.length, 6);
  assert.equal(network.classification.referenceDomain, "cookiebot.com");
  assert.equal(scoreEvidence({ network, forms: { items: [] } }).breakdownSummary.thirdPartyActivity, 5);
});

test("redirected pages classify against the final site, and counts stay independent of sample truncation", () => {
  const phase = classifyEvidence({ finalUrl: "https://www.newsite.com/", investigatedUrl: "https://oldsite.com/",
    network: { requestsByHostname: counts([["oldsite.com", 1], ["cdn.newsite.com", 250], ["outside.com", 45]]), requestSamples: [{ url: "https://oldsite.com/" }] },
    forms: { items: [{ actionKind: "http", resolvedAction: "https://forms.newsite.com/send", inputs: [] }] },
    scripts: { sources: ["https://cdn.newsite.com/a.js", "https://outside.com/a.js"] },
  });
  assert.equal(phase.network.thirdPartyRequests, 46);
  assert.equal(phase.network.firstPartyRequests, 250);
  assert.equal(phase.forms.externalActionCount, 0);
  assert.deepEqual(phase.scripts.domains, ["outside.com"]);
  assert.equal(phase.network.sampleThirdPartyRequests.length, 1);
});

test("consent results apply the same site rule to both observation windows", () => {
  const result = classifyConsentResult({ status: "observed", finalUrl: "https://www.cookiebot.com/",
    beforeRequestsByHostname: counts([["consent.cookiebot.com", 3], ["analytics.google.com", 1]]),
    afterRequestsByHostname: counts([["consent.cookiebot.com", 4], ["analytics.google.com", 2]]),
  });
  assert.equal(result.afterRequests, 2);
  assert.deepEqual(result.afterDomains, ["analytics.google.com"]);
  assert.equal(result.afterRequestsByHostname[0].thirdParty, false);
  assert.equal(result.classification.referenceDomain, "cookiebot.com");
});

test("malformed counters fail explicitly rather than yielding a misleading zero score", () => {
  assert.throws(() => classifyNetwork(undefined, "https://example.com"), /missing/);
  assert.throws(() => classifyNetwork(counts([["example.com", -1]]), "https://example.com"), /Invalid/);
  assert.throws(() => classifyNetwork([], "https://["), /reference URL/);
});
