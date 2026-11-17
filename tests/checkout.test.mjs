import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers.mjs';
import { startCheckout } from '../functions/_lib/checkout.js';
import { onRequest as route } from '../functions/api/supporter/checkout.js';
import { PRICE_ID, PRODUCT_ID, sha256 } from '../functions/_lib/supporter.js';
const origin = 'https://preview.actua.test';
const code = 'x'.repeat(43);
const txn = 'txn_' + 'a'.repeat(26);
function environment(db = database()) {
  return {
    SUPPORTER_DB: db,
    PADDLE_ENVIRONMENT: 'sandbox',
    SUPPORTER_SANDBOX_ENABLED: 'true',
    SUPPORTER_SANDBOX_CHECKOUT_ENABLED: 'true',
    PADDLE_SANDBOX_API_KEY: 'pdl_sdbx_apikey_synthetic',
    PADDLE_SANDBOX_CLIENT_TOKEN: 'test_synthetic',
    TURNSTILE_SECRET_KEY: 'synthetic',
    TURNSTILE_SITE_KEY: 'synthetic',
    SUPPORTER_SANDBOX_ORIGIN: origin,
  };
}
function request(overrides = {}) {
  return new Request(origin + '/api/supporter/checkout', {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: `Bearer ${code}`,
      'X-Turnstile-Token': 'synthetic',
      ...overrides,
    },
    body: JSON.stringify({
      transaction_id: 'attacker',
      price_id: 'attacker',
      customer_id: 'attacker',
    }),
  });
}
function api(options = {}) {
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      calls.push({ url, init });
      if (url.includes('siteverify'))
        return Response.json({
          success: options.verified !== false,
          hostname: new URL(origin).hostname,
          action: options.action || 'actua-checkout',
        });
      assert.equal(url, 'https://sandbox-api.paddle.com/transactions');
      assert.equal(init.redirect, 'manual');
      if (options.throw) throw new Error('synthetic lost response');
      const body = JSON.parse(init.body);
      const result = {
        id: txn,
        status: 'draft',
        currency_code: 'USD',
        collection_mode: 'automatic',
        custom_data: body.custom_data,
        items: [
          {
            quantity: 1,
            price: {
              id: PRICE_ID,
              product_id: PRODUCT_ID,
              billing_cycle: null,
              trial_period: null,
              unit_price: { amount: '299', currency_code: 'USD' },
            },
          },
        ],
      };
      if (options.mutate) options.mutate(result);
      return Response.json({ data: result });
    },
  };
}
const apiCalls = fake => fake.calls.filter(c => c.url.includes('sandbox-api'));

test('server fixes SKU and URL, binds before exposing checkout, and stores only hashed recovery code', async () => {
  const env = environment(),
    fake = api();
  const response = await startCheckout(request(), env, fake.fetch);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { transaction_id: txn });
  const call = apiCalls(fake)[0],
    payload = JSON.parse(call.init.body);
  assert.deepEqual(payload.items, [{ price_id: PRICE_ID, quantity: 1 }]);
  assert.equal(payload.currency_code, 'USD');
  assert.equal(payload.collection_mode, 'automatic');
  assert.deepEqual(payload.checkout, { url: origin + '/api/supporter/checkout' });
  assert.equal(payload.customer_id, undefined);
  assert.equal(call.init.headers.Authorization, 'Bearer ' + env.PADDLE_SANDBOX_API_KEY);
  const row = env.SUPPORTER_DB.sqlite.prepare('SELECT * FROM purchase_intents').get();
  assert.equal(row.transaction_id, txn);
  assert.equal(row.recovery_hash, await sha256(code));
  assert.equal(payload.custom_data.actua_checkout_intent, row.id);
  assert.equal(
    env.SUPPORTER_DB.sqlite.prepare('SELECT state FROM checkout_attempts').get().state,
    'ready',
  );
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('lost browser response and concurrent retries use the same transaction without another Paddle creation', async () => {
  const env = environment(),
    fake = api();
  const responses = await Promise.all([
    startCheckout(request(), env, fake.fetch),
    startCheckout(request(), env, fake.fetch),
  ]);
  assert.ok(responses.some(r => r.status === 200));
  assert.equal(apiCalls(fake).length, 1);
  const retried = await startCheckout(request({ 'X-Turnstile-Token': '' }), env, fake.fetch);
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), { transaction_id: txn });
  assert.equal(apiCalls(fake).length, 1);
});

test('ambiguous Paddle outcome never retries a create', async () => {
  const env = environment(),
    fake = api({ throw: true });
  assert.equal((await startCheckout(request(), env, fake.fetch)).status, 503);
  assert.equal((await startCheckout(request(), env, fake.fetch)).status, 409);
  assert.equal(apiCalls(fake).length, 1);
  assert.equal(
    env.SUPPORTER_DB.sqlite.prepare('SELECT transaction_id FROM purchase_intents').get()
      .transaction_id,
    null,
  );
  assert.equal(
    env.SUPPORTER_DB.sqlite.prepare('SELECT state FROM checkout_attempts').get().state,
    'reconcile',
  );
});

test('database failure after Paddle create rolls back the binding and leaves a reconciliation reservation', async () => {
  const env = environment(),
    fake = api();
  env.SUPPORTER_DB.sqlite.exec(
    "CREATE TRIGGER fail_binding BEFORE UPDATE ON purchase_intents BEGIN SELECT RAISE(ABORT, 'synthetic'); END",
  );
  assert.equal((await startCheckout(request(), env, fake.fetch)).status, 503);
  assert.equal(
    env.SUPPORTER_DB.sqlite.prepare('SELECT transaction_id FROM purchase_intents').get()
      .transaction_id,
    null,
  );
  assert.equal((await startCheckout(request(), env, fake.fetch)).status, 409);
  assert.equal(apiCalls(fake).length, 1);
});

test('process crash with creating state fails closed on retry', async () => {
  const env = environment(),
    fake = api();
  await env.SUPPORTER_DB.prepare('INSERT INTO purchase_intents VALUES (?,?,NULL,1)')
    .bind('synthetic', await sha256(code))
    .run();
  await env.SUPPORTER_DB.prepare("INSERT INTO checkout_attempts VALUES (?,'creating',1)")
    .bind('synthetic')
    .run();
  assert.equal((await startCheckout(request(), env, fake.fetch)).status, 409);
  assert.equal(apiCalls(fake).length, 0);
});

test('unverified challenges and wrong action cannot allocate purchases or call Paddle', async () => {
  for (const options of [{ verified: false }, { action: 'other' }]) {
    const env = environment(),
      fake = api(options);
    assert.equal((await startCheckout(request(), env, fake.fetch)).status, 403);
    assert.equal(apiCalls(fake).length, 0);
    assert.equal(
      env.SUPPORTER_DB.sqlite.prepare('SELECT count(*) AS n FROM purchase_intents').get().n,
      0,
    );
  }
});

test('CSRF, missing code, live credentials, missing configuration and disabled flags fail closed', async () => {
  const env = environment(),
    fake = api();
  assert.equal(
    (await startCheckout(request({ Origin: 'https://attacker.test' }), env, fake.fetch)).status,
    403,
  );
  assert.equal((await startCheckout(request({ Origin: '' }), env, fake.fetch)).status, 403);
  assert.equal((await startCheckout(request({ Authorization: '' }), env, fake.fetch)).status, 401);
  for (const change of [
    { SUPPORTER_SANDBOX_CHECKOUT_ENABLED: 'false' },
    { PADDLE_ENVIRONMENT: 'production' },
    { PADDLE_SANDBOX_API_KEY: 'pdl_live_apikey_synthetic' },
    { PADDLE_SANDBOX_CLIENT_TOKEN: 'live_synthetic' },
    { TURNSTILE_SECRET_KEY: '' },
    { SUPPORTER_SANDBOX_ORIGIN: 'http://preview.test' },
  ]) {
    assert.equal((await route({ request: request(), env: { ...env, ...change } })).status, 503);
  }
  assert.equal(apiCalls(fake).length, 0);
});

test('unexpected Paddle transactions cannot be bound', async () => {
  for (const mutate of [
    t => (t.id = 'invalid'),
    t => (t.items[0].price.id = 'other'),
    t => (t.custom_data = {}),
    t => (t.currency_code = 'EUR'),
    t => (t.items[0].price.unit_price.amount = '1'),
    t => (t.status = 'completed'),
  ]) {
    const env = environment(),
      fake = api({ mutate });
    assert.equal((await startCheckout(request(), env, fake.fetch)).status, 503);
    assert.equal(
      env.SUPPORTER_DB.sqlite.prepare('SELECT transaction_id FROM purchase_intents').get()
        .transaction_id,
      null,
    );
  }
});

test('sandbox page is gated, noncacheable, unindexed and contains only the public test token', async () => {
  const env = environment();
  const response = await route({
    request: new Request(origin + '/api/supporter/checkout?_ptxn=attacker'),
    env,
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.ok(response.headers.get('Content-Security-Policy').includes("frame-ancestors 'none'"));
  const policy = response.headers.get('Content-Security-Policy');
  assert.ok(policy.includes("style-src-attr 'unsafe-inline'"));
  assert.match(policy, /style-src 'nonce-[a-z0-9]+';/);
  assert.ok(!policy.split(';').find(part => part.trim().startsWith('script-src ')).includes('unsafe-inline'));
  assert.ok(html.includes("Paddle.Environment.set('sandbox')"));
  assert.ok(html.includes('history.replaceState'));
  assert.ok(html.includes('test_synthetic'));
  assert.ok(!html.includes(env.PADDLE_SANDBOX_API_KEY));
  assert.ok(!html.includes('pdl_live_'));
  assert.equal(
    (
      await route({
        request: new Request(origin + '/api/supporter/checkout'),
        env: { ...env, SUPPORTER_SANDBOX_CHECKOUT_ENABLED: 'false' },
      })
    ).status,
    503,
  );
  assert.equal(
    (await route({ request: new Request('https://attacker.test/api/supporter/checkout'), env }))
      .status,
    403,
  );
});
