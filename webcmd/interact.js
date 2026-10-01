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
  });
});

const actions = [];

// This phase is invoked only inside the session that completed exploration.
// Keep the final redirected page instead of navigating back to the input URL.
const alreadyThere = !!domainOf(await page.url());

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

const finalUrl = await page.url();
const counts = new Map();
for (const request of requests) counts.set(request.domain, (counts.get(request.domain) || 0) + 1);

return {
  phase: "interact",
  investigatedUrl: url,
  finalUrl,
  mainDomain,
  actions,
  continuedExistingPage: alreadyThere,

  network: {
    requestsByHostname: [...counts].map(([hostname, count]) => ({ hostname, count })),
    requestSamples: requests.slice(0, 200),
  },
};
