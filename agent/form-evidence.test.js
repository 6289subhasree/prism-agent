const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { scoreEvidence } = require("../evidence/scorer");

// Execute the real collector, including its page.evaluate callbacks, against
// controlled DOM attributes. No form submissions or external requests occur.
async function collect(forms, pageUrl = "https://www.example.com/redirected/page", baseURI = pageUrl) {
  const document = {
    URL: pageUrl, baseURI,
    querySelectorAll: selector => selector === "form" ? forms.map(attributes => ({
      getAttribute: name => attributes[name] ?? null,
      querySelectorAll: () => [{ getAttribute: name => name === "type" ? "email" : null }],
    })) : [],
  };
  const page = {
    on() {}, async goto() {}, async waitForTimeout() {},
    evaluate: (fn, argument) => vm.runInNewContext(`(${fn.toString()})(argument)`, { document, URL, argument }),
  };
  const source = fs.readFileSync(path.join(__dirname, "../webcmd/explore.js"), "utf8");
  return vm.runInNewContext(`(async () => { ${source} })()`, { page });
}

test("script handlers preserve email evidence without adding external-form points", async () => {
  const evidence = await collect([{ action: "javascript:void(0)" }, { action: " JaVaScRiPt:void(0) " }]);
  assert.equal(evidence.forms.externalActionCount, 0);
  assert.equal(evidence.forms.sensitiveFieldCount, 2);
  assert(evidence.forms.items.every(form => form.actionKind === "script-handler"));
  const score = scoreEvidence(evidence);
  assert.equal(score.breakdownSummary.externalForm, 0);
  assert.equal(score.score, 10);
});

test("form actions resolve against the final page and respect an explicit document base", async () => {
  const evidence = await collect([
    {}, { action: "" }, { action: "#form" }, { action: "submit" },
    { action: "//collector.example.net/submit" }, { action: "https://www.example.com/submit" },
  ], "https://www.example.com/redirected/page", "https://collector.example.net/base/");
  const items = evidence.forms.items;
  assert.equal(items[0].resolvedAction, "https://www.example.com/redirected/page");
  assert.equal(items[1].externalDestination, false);
  assert.equal(items[2].resolvedAction, "https://collector.example.net/base/#form");
  assert.equal(items[3].resolvedAction, "https://collector.example.net/base/submit");
  assert.equal(items[4].externalDestination, true);
  assert.equal(items[5].externalDestination, false);
  assert.equal(evidence.forms.externalActionCount, 3);
  assert.equal(scoreEvidence(evidence).breakdownSummary.externalForm, 20);
});

test("malformed, non-HTTP, and dialog actions do not masquerade as external HTTP destinations", async () => {
  const evidence = await collect([
    { action: "http://[" }, { action: "mailto:person@example.net" },
    { action: "data:text/plain,hello" }, { action: "https://other.example/", method: "dialog" },
    { action: "/submit" },
  ]);
  assert.equal(evidence.forms.count, 5);
  assert.equal(evidence.forms.externalActionCount, 0);
  assert.equal(evidence.forms.items[0].actionKind, "invalid");
  assert.equal(evidence.forms.items[0].resolvedAction, null);
  assert.equal(evidence.forms.items[1].actionKind, "non-http");
  assert.equal(evidence.forms.items[3].actionKind, "dialog");
  assert.equal(evidence.forms.items[4].resolvedAction, "https://www.example.com/submit");
});
