import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { PRODUCT_ID, PRICE_ID, ISSUER, AUDIENCE, TOKEN_LIFETIME,
  verifyWebhook, fulfill, createIntent, bindTransaction, entitlement } from '../functions/_lib/supporter.js';
import { onRequest as webhook } from '../functions/api/supporter/webhook.js';
import { onRequest as entitlementRoute } from '../functions/api/supporter/entitlement.js';

const id = (prefix, char = 'a') => `${prefix}_${char.repeat(26)}`;
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_supporter.sql', import.meta.url), 'utf8'));
  const db = {
    sqlite,
    prepare(sql) {
      return { bind(...args) {
        return {
          async first() { return sqlite.prepare(sql).get(...args) ?? null; },
          async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
        };
      } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { for (const statement of statements) await statement.run(); sqlite.exec('COMMIT'); }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  return db;
}
function completed(eventChar = 'a') {
  return { event_id: id('evt', eventChar), event_type: 'transaction.completed', occurred_at: '2026-11-17T07:00:00Z',
    data: { id: id('txn'), customer_id: id('ctm'), status: 'completed', currency_code: 'USD', subscription_id: null,
      items: [{ quantity: 1, price: { id: PRICE_ID, product_id: PRODUCT_ID,
        unit_price: { amount: '299', currency_code: 'USD' }, billing_cycle: null, trial_period: null } }] } };
}
function refund(status = 'approved', eventChar = 'b') {
  return { event_id: id('evt', eventChar), event_type: 'adjustment.updated', occurred_at: '2026-11-17T08:00:00Z',
    data: { id: id('adj'), transaction_id: id('txn'), status, action: 'refund' } };
}
const count = (db, table) => db.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const secret = 'synthetic-webhook-secret';
function signedRequest(body, signingSecret = secret, stamp = Math.floor(Date.now() / 1000)) {
  const h1 = createHmac('sha256', signingSecret).update(`${stamp}:${body}`).digest('hex');
  return new Request('https://example.test/api/supporter/webhook', { method: 'POST', body,
    headers: { 'Paddle-Signature': `ts=${stamp};h1=${h1}` } });
}
const baseEnv = db => ({ SUPPORTER_DB: db, PADDLE_ENVIRONMENT: 'sandbox',
  SUPPORTER_SANDBOX_ENABLED: 'true', PADDLE_NOTIFICATION_WEBHOOK_SECRET: secret });

 test('HMAC verifies raw UTF-8 bytes, rotation, skew and tampering', async () => {
  const now = 1800000000000, stamp = now / 1000;
  const body = '{ "greeting": "চমৎকার" }';
  const raw = new TextEncoder().encode(body);
  const sig = createHmac('sha256', secret).update(`${stamp}:${body}`).digest('hex');
  await verifyWebhook(raw, `ts=${stamp};h1=${'0'.repeat(64)};h1=${sig}`, secret, now);
  for (const bad of [`ts=${stamp};h1=xyz`, `ts=${stamp};ts=${stamp};h1=${sig}`, `h1=${sig}`]) {
    await assert.rejects(verifyWebhook(raw, bad, secret, now));
  }
  await assert.rejects(verifyWebhook(new TextEncoder().encode(JSON.stringify(JSON.parse(body))), `ts=${stamp};h1=${sig}`, secret, now));
  await assert.rejects(verifyWebhook(raw, `ts=${stamp};h1=${sig}`, 'wrong', now));
  await assert.rejects(verifyWebhook(raw, `ts=${stamp};h1=${sig}`, secret, now + 6000));
  await assert.rejects(verifyWebhook(raw, `ts=${stamp};h1=${sig}`, secret, now - 6000));
 });

test('duplicate completions and distinct events for one transaction fulfill once', async () => {
  const db = database();
  await fulfill(db, completed()); await fulfill(db, completed()); await fulfill(db, completed('c'));
  assert.equal(count(db, 'purchases'), 1); assert.equal(count(db, 'processed_events'), 2);
});

test('only the exact one-time catalog purchase is fulfilled', async () => {
  const changes = [
    e => e.data.items[0].price.id = id('pri'),
    e => e.data.items[0].price.product_id = id('pro'),
    e => e.data.items[0].price.unit_price.amount = '1',
    e => e.data.items[0].quantity = 2,
    e => e.data.items.push(structuredClone(e.data.items[0])),
    e => e.data.items[0].price.billing_cycle = { interval: 'month', frequency: 1 },
    e => e.data.subscription_id = id('sub'),
    e => e.data.currency_code = 'EUR',
    e => e.data.status = 'paid',
    e => e.data.discount_id = id('dsc'),
  ];
  for (const change of changes) {
    const db = database(), event = completed(); change(event); await fulfill(db, event);
    assert.equal(count(db, 'purchases'), 0);
  }
});

test('refund before completion stays revoked; pending/rejected refunds do not revoke', async () => {
  const db = database(); await fulfill(db, refund()); await fulfill(db, completed()); await fulfill(db, refund());
  assert.equal(count(db, 'purchases'), 1); assert.equal(count(db, 'revocations'), 1);
  for (const status of ['pending_approval', 'rejected']) {
    const db2 = database(); await fulfill(db2, completed()); await fulfill(db2, refund(status));
    assert.equal(count(db2, 'revocations'), 0);
  }
});

test('chargebacks revoke and reversals do not automatically restore', async () => {
  const db = database(), chargeback = refund(); chargeback.data.action = 'chargeback';
  await fulfill(db, chargeback);
  const reversal = refund('approved', 'd'); reversal.data.action = 'chargeback_reverse';
  await fulfill(db, reversal); assert.equal(count(db, 'revocations'), 1);
});

test('ledger failure rolls back fulfillment and successful retry recovers', async () => {
  const db = database();
  db.sqlite.exec("CREATE TRIGGER fail_ledger BEFORE INSERT ON processed_events BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  await assert.rejects(fulfill(db, completed())); assert.equal(count(db, 'purchases'), 0);
  db.sqlite.exec('DROP TRIGGER fail_ledger'); await fulfill(db, completed()); assert.equal(count(db, 'purchases'), 1);
});

test('webhook rejects invalid inputs, disabled/live configuration and storage failures', async () => {
  const db = database(), env = baseEnv(db), body = JSON.stringify(completed());
  assert.equal((await webhook({ request: signedRequest(body, 'wrong'), env })).status, 503);
  assert.equal((await webhook({ request: signedRequest(body, secret, 1), env })).status, 503);
  assert.equal((await webhook({ request: signedRequest('{'), env })).status, 503);
  assert.equal((await webhook({ request: signedRequest(body), env: { ...env, PADDLE_ENVIRONMENT: 'production' } })).status, 503);
  assert.equal((await webhook({ request: signedRequest(body), env: { ...env, SUPPORTER_SANDBOX_ENABLED: 'false' } })).status, 503);
  assert.equal((await webhook({ request: signedRequest('x'.repeat(262145)), env })).status, 503);
  assert.equal(count(db, 'purchases'), 0);
  assert.equal((await webhook({ request: new Request('https://example.test'), env })).status, 405);
  db.sqlite.exec('DROP TABLE processed_events');
  assert.equal((await webhook({ request: signedRequest(body), env })).status, 503);
  assert.equal(count(db, 'purchases'), 0);
});

test('valid webhook is durable before acknowledgment and never leaks customer details', async () => {
  const db = database(), env = baseEnv(db);
  const response = await webhook({ request: signedRequest(JSON.stringify(completed())), env });
  assert.equal(response.status, 200); assert.equal(count(db, 'purchases'), 1);
  assert.deepEqual(await response.json(), { received: true });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('signed sandbox entitlement requires server-bound recovery code and stops refreshing after refund', async () => {
  const db = database(), keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const env = { ...baseEnv(db), SUPPORTER_SIGNING_KEY_ID: 'synthetic-1',
    SUPPORTER_SIGNING_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey)) };
  const { intentId, recoveryCode } = await createIntent(db);
  const request = () => new Request('https://example.test/api/supporter/entitlement', { method: 'POST', headers: { Authorization: `Bearer ${recoveryCode}` } });
  assert.equal((await entitlement(request(), env)).status, 403);
  await fulfill(db, completed()); // completion alone cannot claim an arbitrary transaction
  assert.equal((await entitlement(request(), env)).status, 403);
  await bindTransaction(db, intentId, id('txn'));
  await assert.rejects(bindTransaction(db, intentId, id('txn', 'b')));
  const response = await entitlement(request(), env); assert.equal(response.status, 200);
  const { entitlement: token } = await response.json();
  const [header, payload, sig] = token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, ISSUER); assert.equal(claims.aud, AUDIENCE);
  assert.equal(claims.sub, intentId); assert.equal(claims.environment, 'sandbox');
  assert.equal(claims.exp - claims.iat, TOKEN_LIFETIME); assert.deepEqual(claims.extras, ['supporter']);
  assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'ES256');
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey,
    Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${header}.${payload}`)), true);
  assert.equal(db.sqlite.prepare('SELECT recovery_hash FROM purchase_intents').get().recovery_hash.includes(recoveryCode), false);
  // The saved code recovers the purchase on a fresh installation.
  assert.equal((await entitlement(request(), env)).status, 200);
  await fulfill(db, refund()); assert.equal((await entitlement(request(), env)).status, 403);
  await fulfill(db, completed('c')); assert.equal((await entitlement(request(), env)).status, 403);
  assert.equal((await entitlement(new Request('https://example.test?transaction_id=' + id('txn')), env)).status, 401);
  assert.equal((await entitlementRoute({ request: request(), env: { ...env, PADDLE_ENVIRONMENT: 'production' } })).status, 503);
});
