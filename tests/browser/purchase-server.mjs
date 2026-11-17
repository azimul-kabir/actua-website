// Local-only browser fixture. All provider and POST responses are intercepted by
// purchase-flow.py; this server never uses service credentials or sends emails.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { checkoutPage } from '../../functions/_lib/checkout-page.js';
import { recoveryPage } from '../../functions/_lib/recovery-page.js';
const env = { PADDLE_SANDBOX_CLIENT_TOKEN: 'test_synthetic', TURNSTILE_SITE_KEY: 'synthetic_site_key' };
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (req.method === 'GET' && ['/api/supporter/checkout', '/api/supporter/recovery'].includes(pathname)) {
    const response = pathname.endsWith('/checkout') ? checkoutPage(env) : recoveryPage(env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    return res.end(await response.text());
  }
  if (pathname === '/images/actua-icon.svg' || pathname === '/favicon.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(await readFile(new URL('../../' + pathname.slice(1), import.meta.url)));
  }
  res.writeHead(404); res.end();
});
server.listen(Number(process.env.PURCHASE_TEST_PORT || 4173), '127.0.0.1', () => process.stdout.write('ready\n'));
