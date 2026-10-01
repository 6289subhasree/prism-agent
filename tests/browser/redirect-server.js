const http = require('node:http');

// A real HTTP redirect cannot be safely mocked by routing each hop: Playwright
// only routes the first URL in a redirect chain. Keep both hops on loopback.
async function startRedirectServer() {
  let finalUrl;
  const server = http.createServer((req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { location: finalUrl });
      return res.end();
    }
    if (req.url === '/resource.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      return res.end('window.redirectFixtureLoaded = true;');
    }
    if (req.url !== '/destination') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end('<!doctype html><title>PRISM local redirect fixture</title><script src="/resource.js"></script><h1 id="redirect-fixture">Local redirect destination</h1>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  finalUrl = `http://127.0.0.1:${port}/destination`;
  return {
    port, startUrl: `http://localhost:${port}/start`, finalUrl,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
module.exports = { startRedirectServer };
