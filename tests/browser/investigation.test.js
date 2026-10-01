const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { classifyEvidence, classifyConsentResult } = require('../../evidence/domain-classifier');
const { compareConsent } = require('../../agent/consent-comparison');
const { analyzeConsent } = require('../../agent/consent');
const { startRedirectServer } = require('./redirect-server');
const root = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(__dirname, 'fixtures/consent.html'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let browser;

before(async () => {
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) {
    throw new Error('Browser tests require Chromium. Run npm run test:browser:install, then npm run test:browser.', { cause: error });
  }
});
after(async () => { await browser?.close(); });

// Every URL is intercepted and fulfilled locally. No public website or API key
// is used, and each fixture gets a fresh browser context.
async function withFixture(scenario, callback) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const target = `https://www.example.com/fixtures?scenario=${scenario}`;
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.example.com') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '', headers: { 'access-control-allow-origin': '*' } });
  });
  const page = await context.newPage();
  try { return await callback(page, target); }
  finally { await context.close(); }
}
async function execute(script, page, url, choice = '') {
  const source = fs.readFileSync(path.join(root, 'webcmd', script), 'utf8')
    .replaceAll('"__LEAKLENS_URL__"', JSON.stringify(url))
    .replaceAll('"__PRISM_CHOICE__"', JSON.stringify(choice));
  return new AsyncFunction('page', source)(page);
}

test('real browser collection excludes same-site scripts and form actions', { timeout: 20000 }, async () => {
  await withFixture('visible', async (page, target) => {
    const result = classifyEvidence(await execute('explore.js', page, target));
    assert.equal(await page.title(), 'PRISM consent regression fixture', 'The test must load its controlled fixture');
    assert.equal(result.network.classification.referenceDomain, 'example.com');
    assert(result.network.requestsByHostname.some(host => host.hostname === 'cdn.example.com' && !host.thirdParty), JSON.stringify(result.network.requestsByHostname));
    assert(result.network.domains.includes('analytics.example.net'));
    assert.equal(result.forms.externalActionCount, 0);
    assert.deepEqual(result.scripts.domains, ['analytics.example.net']);
    assert.equal(result.forms.items[1].actionKind, 'script-handler');
  });
});

test('real HTTP redirects use the final page identity without visiting a public site', { timeout: 20000 }, async () => {
  const server = await startRedirectServer();
  let context;
  try {
    context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === String(server.port)
        ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const result = classifyEvidence(await execute('explore.js', page, server.startUrl));
    assert.equal(await page.title(), 'PRISM local redirect fixture');
    assert.equal(await page.evaluate(() => window.redirectFixtureLoaded), true);
    assert.equal(result.finalUrl, server.finalUrl);
    assert.equal(result.network.classification.referenceUrl, server.finalUrl);
    assert.equal(result.network.classification.referenceHostname, '127.0.0.1');
    assert(result.network.requestsByHostname.some(host => host.hostname === '127.0.0.1' && !host.thirdParty));
    assert(result.network.domains.includes('localhost'), 'The original navigation host differs from the final page');
  } finally {
    try { await context?.close(); } finally { await server.close(); }
  }
});

test('real DOM consent inspection excludes hidden and disabled controls and deduplicates nested containers', async () => {
  await withFixture('hidden', async (page, url) => {
    await page.goto(url);
    const result = analyzeConsent(await execute('consent.js', page, url));
    assert.equal(result.bannerCount, 1);
    assert.deepEqual(result.controls.map(control => control.label), ['Deny', 'Allow all']);
    assert.deepEqual(await page.evaluate(() => window.fixtureClicks), []);
  });
});

test('delayed controls are clicked once; post-click requests use the shared site classifier', { timeout: 20000 }, async () => {
  await withFixture('delayed', async (page, url) => {
    const result = classifyConsentResult(await execute('consent-experiment.js', page, url, 'accept'));
    assert.equal(result.status, 'observed');
    assert.equal(result.controlDismissed, true);
    assert.equal(result.afterRequests, 1);
    assert.deepEqual(result.afterDomains, ['analytics.example.net']);
    assert.deepEqual(await page.evaluate(() => window.fixtureClicks), ['accept']);
  });
});

for (const scenario of ['absent', 'ambiguous']) {
  test(`${scenario} controls are skipped without any click`, { timeout: 15000 }, async () => {
    await withFixture(scenario, async (page, url) => {
      const result = await execute('consent-experiment.js', page, url, 'reject');
      assert.equal(result.status, 'skipped');
      assert.deepEqual(await page.evaluate(() => window.fixtureClicks), []);
    });
  });
}

test('an undismissed banner withholds comparison even when both experiments captured traffic', { timeout: 25000 }, async () => {
  const result = await compareConsent({
    // Only Webcmd process/profile plumbing is stubbed; DOM, clicks and traffic
    // are observed in fresh real browser contexts using the production script.
    run: args => args[0] === 'profile' ? '{"created":true}' : args[3] === 'create' ? '{"session":"fixture"}' : '{}',
    parseJson: JSON.parse,
    runExperiment: ({ choice }) => withFixture('persistent', async (page, url) =>
      classifyConsentResult(await execute('consent-experiment.js', page, url, choice))),
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.comparison, null);
  assert(result.runs.every(run => run.status === 'observed' && run.controlDismissed === false));
  assert.equal(result.runs[0].afterRequests, 0);
  assert.equal(result.runs[1].afterRequests, 1);
});
