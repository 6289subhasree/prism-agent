const targetUrl = "__LEAKLENS_URL__";
// Read visible consent controls without clicking or changing consent state.
return await page.evaluate(() => {
  const visible = (el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0 &&
      !el.closest('[hidden], [aria-hidden="true"]');
  };
  const selector = '[role="dialog"], [aria-modal="true"], [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], #onetrust-banner-sdk';
  const candidates = [...document.querySelectorAll(selector)].filter(el =>
    visible(el) && /\b(cookie|cookies|consent)\b/i.test(el.innerText || '') &&
    el.querySelector('button, [role="button"], input[type="button"], a')
  );
  // Keep the outer matching container to avoid counting nested controls twice.
  const banners = candidates.filter(el => !candidates.some(other => other !== el && other.contains(el))).slice(0, 5);
  const controls = [];
  banners.forEach((banner, bannerIndex) => {
    for (const el of banner.querySelectorAll('button, [role="button"], input[type="button"], a')) {
      if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const label = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 160);
      if (label) controls.push({ bannerIndex, label });
      if (controls.length >= 50) break;
    }
  });
  return {
    observedAt: new Date().toISOString(),
    pageUrl: location.href,
    bannerCount: banners.length,
    controls: controls.slice(0, 50),
    scope: 'top-level-document',
  };
});
