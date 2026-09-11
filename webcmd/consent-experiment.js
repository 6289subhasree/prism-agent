const url = "__LEAKLENS_URL__";
const choice = "__PRISM_CHOICE__";
const requests = [];
let collectingAfter = false;
function hostname(value) {
  const match = String(value).match(/^https?:\/\/([^/:?#]+)/i);
  return match ? match[1].toLowerCase() : null;
}
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
const mainDomain = hostname(await page.url());
page.on('request', req => {
  const domain = hostname(req.url());
  if (domain && domain !== mainDomain) requests.push({ domain, after: collectingAfter });
});
await page.waitForTimeout(3000);
// Select only one explicit choice inside a visible cookie/consent container.
const selected = await page.evaluate((action) => {
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
  if (matches.length !== 1) return { status: 'skipped', reason: matches.length ? 'Multiple matching controls; no click performed' : 'No unambiguous visible control; no click performed' };
  const el = matches[0];
  const label = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim();
  el.setAttribute('data-prism-consent-target', action);
  return { status: 'ready', label };
}, choice);
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
return {
  status: 'observed', clickedLabel: selected.label, controlDismissed,
  beforeDomains: [...new Set(requests.filter(r => !r.after).map(r => r.domain))],
  afterDomains: [...new Set(requests.filter(r => r.after).map(r => r.domain))],
  afterRequests: requests.filter(r => r.after).length, observationMs: 3000,
};
