import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutPage } from '../functions/_lib/checkout-page.js';
import { recoveryPage } from '../functions/_lib/recovery-page.js';
const env = { PADDLE_SANDBOX_CLIENT_TOKEN: 'test_synthetic', TURNSTILE_SITE_KEY: 'synthetic_site_key' };

for (const [name, render] of [['checkout', checkoutPage], ['recovery', recoveryPage]]) {
  test(`${name} wizard keeps executable elements nonce-protected and credentials masked`, async () => {
    const response = render(env), html = await response.text();
    const policy = response.headers.get('Content-Security-Policy');
    const nonce = policy.match(/script-src 'nonce-([^']+)'/)[1];
    assert.ok(html.includes(`<style nonce="${nonce}">`));
    assert.ok(html.includes(`<script nonce="${nonce}">`));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    assert.ok(policy.includes("frame-ancestors 'none'"));
    assert.ok(policy.includes("form-action 'none'"));
    assert.ok(!html.includes('type="text"'));
    assert.ok(html.includes('type="password"'));
    assert.ok(html.includes('aria-current="step"'));
    assert.ok(html.includes('id="save-confirmation" class="confirm" hidden'));
    assert.ok(html.includes('[hidden]{display:none!important}'));
    assert.ok(!/on(click|submit|change)=/.test(html));
    if (name === 'checkout') assert.ok(policy.includes("style-src-attr 'unsafe-inline'"));
    else assert.ok(!policy.includes('unsafe-inline'));
  });
}
