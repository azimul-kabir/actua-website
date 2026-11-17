import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database } from './helpers.mjs';
import { requestRecovery, processRecovery, redeemRecovery } from '../functions/_lib/recovery.js';
import { sha256, PRICE_ID, PRODUCT_ID } from '../functions/_lib/supporter.js';
import { onRequest as runner } from '../functions/api/supporter/recovery/process.js';
import { onRequest as route } from '../functions/api/supporter/recovery.js';
const origin = 'https://sandbox.actua.test',
  email = 'buyer@example.test',
  oldCode = 'a'.repeat(43),
  newCode = 'b'.repeat(43);
const ctm = 'ctm_' + 'a'.repeat(26),
  txn = 'txn_' + 'a'.repeat(26);
function environment() {
  return {
    SUPPORTER_DB: database(),
    PADDLE_ENVIRONMENT: 'sandbox',
    SUPPORTER_SANDBOX_ENABLED: 'true',
    SUPPORTER_SANDBOX_RECOVERY_ENABLED: 'true',
    PADDLE_SANDBOX_API_KEY: 'pdl_sdbx_apikey_synthetic',
    RESEND_API_KEY: 're_synthetic',
    SUPPORTER_RECOVERY_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64url'),
    SUPPORTER_RECOVERY_JOB_TOKEN: 's'.repeat(43),
    TURNSTILE_SECRET_KEY: 'synthetic',
    TURNSTILE_SITE_KEY: 'synthetic',
    SUPPORTER_SANDBOX_ORIGIN: origin,
    SUPPORTER_EMAIL_FROM: 'Actua <support@notify.azimulkabir.com>',
  };
}
function request(address = email, headers = {}) {
  return new Request(origin + '/api/supporter/recovery', {
    method: 'POST',
    headers: {
      Origin: origin,
      'X-Turnstile-Token': 'synthetic',
      'CF-Connecting-IP': '192.0.2.1',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify({ email: address }),
  });
}
function redeem(token, code = newCode) {
  return new Request(origin + '/api/supporter/recovery/redeem', {
    method: 'POST',
    headers: { Origin: origin, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ recovery_code: code }),
  });
}
async function seed(env) {
  await env.SUPPORTER_DB.prepare(
    'INSERT INTO purchase_intents (id,recovery_hash,transaction_id,created_at) VALUES (?,?,?,1)',
  )
    .bind('intent', await sha256(oldCode), txn)
    .run();
  await env.SUPPORTER_DB.prepare('INSERT INTO purchases VALUES (?,?,?,?,?)')
    .bind(txn, ctm, PRODUCT_ID, PRICE_ID, '2026-11-17T07:00:00Z')
    .run();
}
function fake(options = {}) {
  const sent = [],
    calls = [];
  return {
    sent,
    calls,
    async fetch(url, init) {
      calls.push(url);
      if (url.includes('siteverify'))
        return Response.json({
          success: options.verified !== false,
          action: 'actua-recovery',
          hostname: new URL(origin).hostname,
        });
      if (url.startsWith('https://sandbox-api.paddle.com/customers')) {
        assert.equal(new URL(url).searchParams.get('email'), email);
        if (options.lookup) await options.lookup();
        return Response.json({
          data: options.customers ?? [{ id: ctm, email, status: 'active' }],
          meta: { pagination: { has_more: false } },
        });
      }
      assert.equal(url, 'https://api.resend.com/emails');
      sent.push({ headers: init.headers, body: JSON.parse(init.body) });
      if (options.retryAfter)
        return Response.json(
          { error: 'rate limited' },
          { status: 429, headers: { 'Retry-After': String(options.retryAfter) } },
        );
      if (options.deliveryFails) throw new Error('synthetic provider response loss');
      return Response.json({ id: 'synthetic-message' });
    },
  };
}
const challenge = f => f.sent[0].body.text.match(/\n\n([A-Za-z0-9_-]{43})\n\n/)[1];
const counts = env =>
  env.SUPPORTER_DB.sqlite.prepare('SELECT count(*) AS n FROM recovery_requests').get().n;

test('request queues encrypted data and gives the same generic response for all purchase states', async () => {
  const env = environment(),
    f = fake();
  const response = await requestRecovery(request(), env, f.fetch);
  assert.equal(response.status, 202);
  const expected = await response.json();
  assert.equal(f.sent.length, 0);
  const row = env.SUPPORTER_DB.sqlite.prepare('SELECT * FROM recovery_requests').get();
  assert.ok(!row.ciphertext.includes(email));
  assert.equal(row.stage, 'lookup');
  const env2 = environment();
  await seed(env2);
  assert.deepEqual(await (await requestRecovery(request(), env2, f.fetch)).json(), expected);
});

test('trusted Paddle recipient, durable Resend idempotency, and atomic single-use credential replacement', async () => {
  const env = environment();
  await seed(env);
  const f = fake();
  await requestRecovery(request(), env, f.fetch);
  assert.equal(await processRecovery(env, f.fetch), true);
  assert.equal(f.sent.length, 1);
  const message = f.sent[0];
  assert.deepEqual(message.body.to, [email]);
  assert.equal(message.body.reply_to, 'actua@azimulkabir.com');
  assert.equal(message.body.from, env.SUPPORTER_EMAIL_FROM);
  assert.ok(message.headers['Idempotency-Key'].startsWith('actua-sandbox-recovery/'));
  const token = challenge(f),
    row = env.SUPPORTER_DB.sqlite.prepare('SELECT * FROM recovery_challenges').get();
  assert.equal(row.token_hash, await sha256(token));
  assert.notEqual(row.token_hash, token);
  assert.equal(
    env.SUPPORTER_DB.sqlite.prepare('SELECT ciphertext FROM recovery_requests').get().ciphertext,
    '',
  );
  assert.equal((await redeemRecovery(redeem(token), env)).status, 200);
  assert.equal((await redeemRecovery(redeem(token), env)).status, 403);
  assert.equal(
    env.SUPPORTER_DB.sqlite.prepare('SELECT recovery_hash FROM purchase_intents').get()
      .recovery_hash,
    await sha256(newCode),
  );
  assert.equal(
    env.SUPPORTER_DB.sqlite
      .prepare('SELECT count(*) AS n FROM purchase_intents WHERE recovery_hash=?')
      .get(await sha256(oldCode)).n,
    0,
  );
});

test('lost provider response retries the exact same encrypted delivery with the same idempotency key', async () => {
  const env = environment();
  await seed(env);
  const f = fake({ deliveryFails: true });
  await requestRecovery(request(), env, f.fetch);
  await processRecovery(env, f.fetch);
  const queued = env.SUPPORTER_DB.sqlite.prepare('SELECT * FROM recovery_requests').get();
  assert.equal(queued.stage, 'deliver');
  assert.ok(!queued.ciphertext.includes(email));
  assert.ok(!queued.ciphertext.includes(challenge(f)));
  await processRecovery(env, f.fetch, Date.now() + 61000);
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent[0], f.sent[1]);
  assert.equal(f.calls.filter(u => u.includes('/customers')).length, 1);
});

test('unknown, mismatched, archived, unbound and refunded customers never receive email', async () => {
  for (const options of [
    { customers: [] },
    { customers: [{ id: ctm, email: 'other@example.test', status: 'active' }] },
    { customers: [{ id: ctm, email, status: 'archived' }] },
    { unbound: true },
    { refunded: true },
  ]) {
    const env = environment();
    await seed(env);
    const f = fake(options);
    if (options.unbound) env.SUPPORTER_DB.sqlite.exec('DELETE FROM purchase_intents');
    if (options.refunded)
      await env.SUPPORTER_DB.prepare('INSERT INTO revocations VALUES (?,?,?,?)')
        .bind('adj', txn, 'refund', '2026-11-17')
        .run();
    await requestRecovery(request(), env, f.fetch);
    await processRecovery(env, f.fetch);
    assert.equal(f.sent.length, 0);
    assert.equal(
      env.SUPPORTER_DB.sqlite.prepare('SELECT ciphertext FROM recovery_requests').get().ciphertext,
      '',
    );
  }
});

test('refund after email, expired challenges and malformed codes cannot recover', async () => {
  for (const scenario of ['refund', 'expiry']) {
    const env = environment();
    await seed(env);
    const f = fake(),
      now = Date.now();
    await requestRecovery(request(), env, f.fetch, now);
    await processRecovery(env, f.fetch, now);
    if (scenario === 'refund')
      await env.SUPPORTER_DB.prepare('INSERT INTO revocations VALUES (?,?,?,?)')
        .bind('adj', txn, 'refund', '2026-11-17')
        .run();
    assert.equal(
      (await redeemRecovery(redeem(challenge(f)), env, now + (scenario === 'expiry' ? 901000 : 0)))
        .status,
      403,
    );
    assert.equal(
      env.SUPPORTER_DB.sqlite.prepare('SELECT recovery_hash FROM purchase_intents').get()
        .recovery_hash,
      await sha256(oldCode),
    );
  }
  const env = environment();
  assert.equal((await redeemRecovery(redeem('invalid'), env)).status, 400);
});

test('a successful redemption invalidates other outstanding email challenges', async () => {
  const env = environment();
  await seed(env);
  const f = fake();
  await requestRecovery(request(), env, f.fetch);
  await processRecovery(env, f.fetch);
  await requestRecovery(request(), env, f.fetch);
  await processRecovery(env, f.fetch);
  const first = challenge(f),
    second = f.sent[1].body.text.match(/\n\n([A-Za-z0-9_-]{43})\n\n/)[1];
  assert.equal((await redeemRecovery(redeem(first), env)).status, 200);
  assert.equal((await redeemRecovery(redeem(second, 'c'.repeat(43)), env)).status, 403);
});

test('credential update failure rolls back challenge consumption for a safe retry', async () => {
  const env = environment();
  await seed(env);
  const f = fake();
  await requestRecovery(request(), env, f.fetch);
  await processRecovery(env, f.fetch);
  env.SUPPORTER_DB.sqlite.exec(
    "CREATE TRIGGER fail_recovery BEFORE UPDATE ON purchase_intents BEGIN SELECT RAISE(ABORT,'synthetic'); END",
  );
  await assert.rejects(redeemRecovery(redeem(challenge(f)), env));
  assert.equal(
    env.SUPPORTER_DB.sqlite.prepare('SELECT consumed_at FROM recovery_challenges').get()
      .consumed_at,
    null,
  );
  env.SUPPORTER_DB.sqlite.exec('DROP TRIGGER fail_recovery');
  assert.equal((await redeemRecovery(redeem(challenge(f)), env)).status, 200);
});

test('per-email limits return generic responses without queuing excess email', async () => {
  const env = environment(),
    f = fake();
  let body;
  for (let i = 0; i < 4; i++) {
    const r = await requestRecovery(request(), env, f.fetch);
    assert.equal(r.status, 202);
    const value = await r.json();
    if (body) assert.deepEqual(value, body);
    body = value;
  }
  assert.equal(counts(env), 3);
  const rows = env.SUPPORTER_DB.sqlite.prepare('SELECT bucket_hash FROM recovery_limits').all();
  assert.ok(rows.every(row => /^[a-f0-9]{64}$/.test(row.bucket_hash)));
});

test('background lease prevents duplicate workers and stale owners cannot stage email', async () => {
  const env = environment();
  await seed(env);
  const f = fake();
  await requestRecovery(request(), env, f.fetch);
  await Promise.all([processRecovery(env, f.fetch), processRecovery(env, f.fetch)]);
  assert.equal(f.sent.length, 1);
  const env2 = environment();
  await seed(env2);
  const stale = fake({
    lookup: async () =>
      env2.SUPPORTER_DB.prepare("UPDATE recovery_requests SET lease_owner='other'").bind().run(),
  });
  await requestRecovery(request(), env2, stale.fetch);
  await processRecovery(env2, stale.fetch);
  assert.equal(stale.sent.length, 0);
  assert.equal(
    env2.SUPPORTER_DB.sqlite.prepare('SELECT count(*) AS n FROM recovery_challenges').get().n,
    0,
  );
});

test('delivery retry bound and expiry cleanup discard encrypted payloads', async () => {
  const env = environment();
  await seed(env);
  const f = fake({ deliveryFails: true });
  const now = Date.now();
  await requestRecovery(request(), env, f.fetch, now);
  for (let i = 0; i < 6; i++) await processRecovery(env, f.fetch, now + i * 61000);
  assert.equal(f.sent.length, 5);
  const job = env.SUPPORTER_DB.sqlite
    .prepare('SELECT stage,ciphertext FROM recovery_requests')
    .get();
  assert.equal(job.stage, 'failed');
  assert.equal(job.ciphertext, '');
  await processRecovery(env, f.fetch, now + 901000);
  assert.equal(
    env.SUPPORTER_DB.sqlite.prepare('SELECT count(*) AS n FROM recovery_challenges').get().n,
    0,
  );
});

test('bad encryption, CSRF, live keys, missing secrets, runner authorization and verification fail closed', async () => {
  const env = environment(),
    f = fake({ verified: false });
  assert.equal((await requestRecovery(request(), env, f.fetch)).status, 403);
  assert.equal(
    (await requestRecovery(request(email, { Origin: 'https://attacker.test' }), env, f.fetch))
      .status,
    403,
  );
  assert.equal(
    (await requestRecovery(request('bad,email@example.test'), env, f.fetch)).status,
    400,
  );
  assert.equal(counts(env), 0);
  for (const override of [
    { PADDLE_SANDBOX_API_KEY: 'pdl_live_apikey_synthetic' },
    { SUPPORTER_SANDBOX_RECOVERY_ENABLED: 'false' },
    { SUPPORTER_RECOVERY_ENCRYPTION_KEY: '' },
    { RESEND_API_KEY: '' },
    { SUPPORTER_EMAIL_FROM: 'attacker@example.test' },
  ]) {
    assert.equal((await route({ request: request(), env: { ...env, ...override } })).status, 503);
  }
  assert.equal(
    (
      await runner({
        request: new Request(origin + '/api/supporter/recovery/process', { method: 'POST' }),
        env,
      })
    ).status,
    401,
  );
  const env2 = environment(),
    f2 = fake();
  await seed(env2);
  await requestRecovery(request(), env2, f2.fetch);
  env2.SUPPORTER_RECOVERY_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString('base64url');
  await processRecovery(env2, f2.fetch);
  assert.equal(f2.sent.length, 0);
});

test('provider Retry-After delays retries without changing the delivery idempotency key', async () => {
  const env = environment();
  await seed(env);
  const f = fake({ retryAfter: 120 }),
    now = Date.now();
  await requestRecovery(request(), env, f.fetch, now);
  await processRecovery(env, f.fetch, now);
  assert.equal(await processRecovery(env, f.fetch, now + 61000), false);
  assert.equal(f.sent.length, 1);
  await processRecovery(env, f.fetch, now + 121000);
  assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent[0], f.sent[1]);
});

test('email redemption requires a replacement different from the current credential', async () => {
  const env = environment();
  await seed(env);
  const f = fake();
  await requestRecovery(request(), env, f.fetch);
  await processRecovery(env, f.fetch);
  assert.equal((await redeemRecovery(redeem(challenge(f), oldCode), env)).status, 403);
  assert.equal(
    env.SUPPORTER_DB.sqlite.prepare('SELECT consumed_at FROM recovery_challenges').get()
      .consumed_at,
    null,
  );
  assert.equal((await redeemRecovery(redeem(challenge(f)), env)).status, 200);
});
