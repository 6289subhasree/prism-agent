// webcmd/explore.js
// __LEAKLENS_URL__ is replaced by controller.js before execution.

const url = "__LEAKLENS_URL__";
const requests = [];

function domainOf(u) {
  const match = String(u).match(/^https?:\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^:/?#]+)(?::\d+)?/i);
  return match ? match[1].replace(/^\[|\]$/g, "").toLowerCase() : null;
}

const mainDomain = domainOf(url);

page.on("request", (req) => {
  const reqUrl = req.url();
  const domain = domainOf(reqUrl);
  if (!domain) return;

  requests.push({
    url: reqUrl,
    domain,
    resourceType: req.resourceType(),
    method: req.method(),
    thirdParty: domain !== mainDomain,
  });
});

await page.goto(url, {
  waitUntil: "domcontentloaded",
  timeout: 20000,
});

await page.waitForTimeout(3000);

const resolvedForms = await page.evaluate(() => {
  const pageDomain = new URL(document.URL).hostname.toLowerCase();
  return Array.from(document.querySelectorAll("form")).map((form) => {
    const action = form.getAttribute("action");
    const method = (form.getAttribute("method") || "get").toLowerCase();
    let resolvedAction = null, actionKind = "invalid", externalDestination = false;
    try {
      // Empty actions target the current document, even with a <base> tag.
      // Explicit relative actions use document.baseURI, including after redirects.
      const destination = new URL(action === null || action === "" ? document.URL : action, document.baseURI);
      resolvedAction = destination.href;
      actionKind = ["http:", "https:"].includes(destination.protocol) ? "http" : "non-http";
      if (destination.protocol === "javascript:") actionKind = "script-handler";
      if (method === "dialog") actionKind = "dialog";
      externalDestination = actionKind === "http" && destination.hostname.toLowerCase() !== pageDomain;
    } catch { /* Keep malformed actions as unknown evidence; do not abort collection. */ }
    // An action attribute does not reveal where JavaScript may send form data.
    return {
    action: form.getAttribute("action") || null,
    method,
    resolvedAction,
    actionKind,
    externalDestination,
    inputs: Array.from(
      form.querySelectorAll("input, textarea")
    ).map((el) => ({
      type: (el.getAttribute("type") || "text").toLowerCase(),
      name:
        el.getAttribute("name") ||
        el.getAttribute("id") ||
        null,
    })),
    };
  });
});

const SENSITIVE_TYPES = ["email", "tel", "password"];

const sensitiveFieldCount = resolvedForms.reduce(
  (sum, f) =>
    sum +
    f.inputs.filter((i) =>
      SENSITIVE_TYPES.includes(i.type)
    ).length,
  0
);

const externalScriptSrcs = await page.evaluate(
  (main) => {
    return Array.from(
      document.querySelectorAll("script[src]")
    )
      .map((s) => s.src)
      .filter((src) => {
        try {
          return new URL(src).hostname !== main;
        } catch {
          return false;
        }
      });
  },
  mainDomain
);

const externalScriptDomains = [
  ...new Set(
    externalScriptSrcs
      .map((src) => domainOf(src))
      .filter(Boolean)
  ),
];

const thirdPartyRequests = requests.filter(
  (r) => r.thirdParty
);

const firstPartyRequests = requests.filter(
  (r) => !r.thirdParty
);

const thirdPartyDomains = [
  ...new Set(
    thirdPartyRequests.map((r) => r.domain)
  ),
];

return {
  phase: "explore",
  investigatedUrl: url,
  mainDomain,

  actions: [
    "navigate",
    "inspect_dom",
    "capture_network",
  ],

  network: {
    totalRequests: requests.length,
    firstPartyRequests:
      firstPartyRequests.length,
    thirdPartyRequests:
      thirdPartyRequests.length,
    uniqueThirdPartyDomains:
      thirdPartyDomains.length,
    domains: thirdPartyDomains,
    sampleThirdPartyRequests:
      thirdPartyRequests.slice(0, 40),
  },

  forms: {
    count: resolvedForms.length,
    externalActionCount:
      resolvedForms.filter(
        (f) => f.externalDestination
      ).length,
    sensitiveFieldCount,
    items: resolvedForms,
  },

  scripts: {
    externalCount:
      externalScriptSrcs.length,
    uniqueExternalDomains:
      externalScriptDomains.length,
    domains: externalScriptDomains,
  },
};
