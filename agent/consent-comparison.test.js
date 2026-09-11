const test = require('node:test');
const assert = require('node:assert/strict');
const { compareConsent } = require('./consent-comparison');
function fixture(experiment, create = true) {
  const calls = [];
  const run = (args, timeout) => {
    calls.push({ args, timeout });
    if (args[0] === 'profile') return JSON.stringify({ created: create });
    if (args[3] === 'create') return JSON.stringify({ session: 'test-session' });
    return '{}';
  };
  return { calls, options: { run, parseJson: JSON.parse, runExperiment: experiment } };
}
const observed = domains => ({ status: 'observed', clickedLabel: 'choice', controlDismissed: true, afterDomains: domains, afterRequests: domains.length, observationMs: 3000 });
test('comparison uses distinct profiles and closes both owned sessions', async () => {
  const f = fixture(({ choice }) => observed(choice === 'accept' ? ['a.test', 'b.test'] : ['a.test']));
  const result = await compareConsent(f.options);
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.comparison.acceptOnlyDomains, ['b.test']);
  assert.equal(result.comparison.requestDifference, 1);
  assert.notEqual(result.runs[0].profileId, result.runs[1].profileId);
  const closes = f.calls.filter(c => c.args[3] === 'close');
  assert.equal(closes.length, 2);
  assert.equal(closes[0].args[1], result.runs[0].profileId);
  assert.equal(closes[1].args[1], result.runs[1].profileId);
});
test('failed first run retains second result and withholds comparison', async () => {
  const f = fixture(({ choice }) => { if (choice === 'reject') throw new Error('click failed'); return observed([]); });
  const result = await compareConsent(f.options);
  assert.equal(result.comparison, null);
  assert.equal(result.runs[0].reason, 'click failed');
  assert.equal(result.runs[1].status, 'observed');
  assert.equal(f.calls.filter(c => c.args[3] === 'close').length, 2);
});
test('no experiment starts if profile freshness is not confirmed', async () => {
  let called = false;
  const f = fixture(() => { called = true; }, false);
  const result = await compareConsent(f.options);
  assert.equal(called, false);
  assert.equal(result.comparison, null);
});
test('unconfirmed choice and skipped controls never produce a comparison', async () => {
  const f = fixture(({ choice }) => choice === 'reject' ? { status: 'skipped', reason: 'ambiguous' } : { ...observed([]), controlDismissed: false });
  assert.equal((await compareConsent(f.options)).comparison, null);
});

test('browser experiment skips ambiguous controls without clicking', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  let clicked = false;
  const page = {
    goto: async () => {}, url: async () => 'https://example.com',
    on: () => {}, waitForTimeout: async () => {},
    evaluate: async () => ({ status: 'skipped', reason: 'Multiple matching controls; no click performed' }),
    locator: () => ({ click: async () => { clicked = true; } }),
  };
  const source = fs.readFileSync(path.join(__dirname, '../webcmd/consent-experiment.js'), 'utf8');
  const result = await vm.runInNewContext('(async () => {' + source + '})()', { page });
  assert.equal(result.status, 'skipped');
  assert.equal(clicked, false);
});

test('browser experiment keeps pre-click and post-click traffic separate', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  let listener, evaluations = 0, clicked = false;
  const page = {
    goto: async () => {}, url: async () => 'https://example.com',
    on: (_event, fn) => { listener = fn; },
    waitForTimeout: async () => listener({ url: () => clicked ? 'https://after.test/pixel' : 'https://before.test/pixel' }),
    evaluate: async () => ++evaluations === 1 ? { status: 'ready', label: 'Deny' } : true,
    locator: () => ({ click: async () => { clicked = true; } }),
  };
  const source = fs.readFileSync(path.join(__dirname, '../webcmd/consent-experiment.js'), 'utf8');
  const result = await vm.runInNewContext('(async () => {' + source + '})()', { page });
  assert.equal(result.afterRequests, 1);
  assert.equal(result.beforeDomains[0], 'before.test');
  assert.equal(result.afterDomains[0], 'after.test');
  assert.equal(result.controlDismissed, true);
});
