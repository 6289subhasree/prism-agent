const url = "__LEAKLENS_URL__";
const choice = "__PRISM_CHOICE__";
const requests = [];
let collectingAfter = false;
function hostname(value) {
  const match = String(value).match(/^https?:\/\/(?:[^@/]+@)?(\[[^\]]+\]|[^:/?#]+)(?::\d+)?/i);
  return match ? match[1].toLowerCase() : null;
}
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
const finalUrl = await page.url();
page.on('request', req => {
  const domain = hostname(req.url());
  if (domain) requests.push({ domain, after: collectingAfter });
});
await page.waitForTimeout(3000);
// Select only one explicit choice inside a visible cookie/consent container.
const selectControl = (action) => {
  const visible = el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0 && r.width > 0 && r.height > 0 && !el.closest('[hidden], [aria-hidden="true"]');
  };
  const containers = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"], [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], #onetrust-banner-sdk')]
    .filter(el => visible(el) && /\b(cookies?|consent)\b/i.test(el.innerText || ''));
  const pattern = action === 'accept' ? /^(accept|allow)( all)?( cookies)?[.!]?$/i : /^(reject|decline|deny)( all)?( cookies)?[.!]?$/i;
  const matches = [...new Set(containers.flatMap(el => [...el.querySelectorAll('button, [role="button"], input[type="button"]')]))].filter(el => {
    const label = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().replace(/\s+/g, ' ');
    return visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && pattern.test(label);
  });
  if (matches.length !== 1) return { status: 'skipped', matchCount: matches.length, reason: matches.length ? 'Multiple matching controls; no click performed' : 'No unambiguous visible control; no click performed' };
  const el = matches[0];
  const label = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim();
  el.setAttribute('data-prism-consent-target', action);
  return { status: 'ready', label };
};
// Consent scripts can render after the initial observation window. Reinspect
// missing controls twice, within the existing experiment timeout. Never retry
// an ambiguous match or a click, and never reload the fresh profile's page.
let selected;
for (let attempt = 0; attempt < 3; attempt++) {
  selected = await page.evaluate(selectControl, choice);
  if (selected.status !== 'skipped' || selected.matchCount !== 0 || attempt === 2) break;
  await page.waitForTimeout(1000);
}
if (selected.status === 'skipped') return selected;
collectingAfter = true;
await page.locator(`[data-prism-consent-target="${choice}"]`).click({ timeout: 5000 });
await page.waitForTimeout(3000);
const controlDismissed = await page.evaluate((action) => {
  const el = document.querySelector(`[data-prism-consent-target="${action}"]`);
  if (!el) return true;
  const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
  return rect.width === 0 || rect.height === 0 || style.display === 'none' || style.visibility === 'hidden' || !!el.closest('[hidden], [aria-hidden="true"]');
}, choice);
const countsFor = after => {
  const counts = new Map();
  for (const request of requests.filter(item => item.after === after)) counts.set(request.domain, (counts.get(request.domain) || 0) + 1);
  return [...counts].map(([hostname, count]) => ({ hostname, count }));
};
return {
  status: 'observed', clickedLabel: selected.label, controlDismissed, finalUrl,
  beforeRequestsByHostname: countsFor(false), afterRequestsByHostname: countsFor(true),
  observationMs: 3000,
};
