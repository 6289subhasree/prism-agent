const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeConsent } = require('./consent');
const base = { observedAt: '2026-09-09T12:00:00.000Z', pageUrl: 'https://example.com', bannerCount: 1, scope: 'top-level-document' };

test('consent detector classifies explicit choices and leaves ambiguous labels unknown', () => {
  const labels = ['Accept all cookies', 'Reject all', 'Cookie settings', 'Accept terms and buy', 'Continue'];
  const result = analyzeConsent({ ...base, controls: labels.map(label => ({ bannerIndex: 0, label })) });
  assert.deepEqual(result.controls.map(c => c.inferredAction), ['accept', 'reject', 'settings', 'unknown', 'unknown']);
});
test('no observed banner is not represented as no tracking or consent compliance', () => {
  const result = analyzeConsent({ ...base, bannerCount: 0, controls: [] });
  assert.equal(result.status, 'not-observed');
  assert.equal(result.limitations.length, 2);
});
test('malformed browser evidence is rejected', () => {
  assert.throws(() => analyzeConsent({ ...base, controls: 'accept' }));
});
test('browser collector excludes hidden controls and deduplicates nested banners', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const control = (label, hidden = false) => ({ innerText: label, hidden, getAttribute: () => null, closest: () => null, getBoundingClientRect: () => ({ width: 20, height: 20 }) });
  const accept = control('Accept all');
  const hidden = control('Reject all', true);
  const inner = { ...control('Cookie consent'), querySelector: () => accept, querySelectorAll: () => [accept], contains: () => false };
  const outer = { ...inner, querySelectorAll: () => [accept, hidden], contains: el => el === inner };
  const context = {
    document: { querySelectorAll: () => [outer, inner] },
    getComputedStyle: el => ({ display: el.hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
    location: { href: base.pageUrl },
  };
  context.page = { evaluate: fn => fn() };
  const source = fs.readFileSync(require('node:path').join(__dirname, '../webcmd/consent.js'), 'utf8');
  const result = await vm.runInNewContext('(async () => {' + source + '})()', context);
  assert.equal(result.bannerCount, 1);
  assert.equal(result.controls.length, 1);
  assert.equal(result.controls[0].label, 'Accept all');
});

test('Deny is a rejection action but unrelated denial text stays unknown', () => {
  const result = analyzeConsent({ ...base, controls: ['Deny', 'Deny all cookies', 'Deny access to account'].map(label => ({ bannerIndex: 0, label })) });
  assert.deepEqual(result.controls.map(c => c.inferredAction), ['reject', 'reject', 'unknown']);
});
