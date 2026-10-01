const test = require('node:test');
const assert = require('node:assert/strict');
const { startRedirectServer } = require('../tests/browser/redirect-server');

test('redirect fixture serves real loopback-only HTTP hops and closes its socket', async () => {
  const server = await startRedirectServer();
  const start = server.startUrl.replace('localhost', '127.0.0.1');
  try {
    const redirect = await fetch(start, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), server.finalUrl);
    await redirect.text();
    const destination = await fetch(start);
    assert.equal(destination.url, server.finalUrl);
    assert.match(await destination.text(), /PRISM local redirect fixture/);
    const script = await fetch(new URL('/resource.js', server.finalUrl));
    assert.match(await script.text(), /redirectFixtureLoaded/);
    const missing = await fetch(new URL('/missing', server.finalUrl));
    assert.equal(missing.status, 404);
  } finally { await server.close(); }
  await assert.rejects(fetch(start));
});
