// webcmd/interact.js
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

const actions = [];

const alreadyThere = (() => {
  try {
    return (
      domainOf(page.url()) === mainDomain &&
      page.url() !== "about:blank"
    );
  } catch {
    return false;
  }
})();

if (!alreadyThere) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 20000,
  });

  actions.push("navigate");
}

await page.evaluate(async () => {
  const step = Math.max(
    200,
    Math.floor(window.innerHeight / 2)
  );

  for (
    let y = 0;
    y < document.body.scrollHeight;
    y += step
  ) {
    window.scrollTo(0, y);

    await new Promise((resolve) =>
      setTimeout(resolve, 250)
    );
  }
});

actions.push("scroll");

await page.waitForTimeout(6000);

actions.push("capture_network");

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
  phase: "interact",
  investigatedUrl: url,
  mainDomain,
  actions,
  continuedExistingPage: alreadyThere,

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
};
