import { PRICE_ID, PRODUCT_ID, sha256, json, requireSandbox } from './supporter.js';

export function checkoutConfig(env) {
  requireSandbox(env);
  if (
    env.SUPPORTER_SANDBOX_CHECKOUT_ENABLED !== 'true' ||
    !env.PADDLE_SANDBOX_API_KEY?.startsWith('pdl_sdbx_apikey_') ||
    !/^test_[A-Za-z0-9]+$/.test(env.PADDLE_SANDBOX_CLIENT_TOKEN ?? '') ||
    !env.TURNSTILE_SECRET_KEY ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(env.TURNSTILE_SITE_KEY ?? '')
  ) {
    throw new Error('Sandbox checkout disabled');
  }
  const origin = new URL(env.SUPPORTER_SANDBOX_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.SUPPORTER_SANDBOX_ORIGIN)
    throw new Error('Invalid preview origin');
  return origin.origin;
}

export async function checkTurnstile(request, env, fetcher = fetch, action = 'actua-checkout') {
  const proof = request.headers.get('X-Turnstile-Token');
  if (!proof || proof.length > 2048) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: proof });
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.set('remoteip', ip);
  const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(8000),
    redirect: 'manual',
  });
  if (!response.ok) return false;
  const result = await response.json();
  return (
    result.success === true &&
    result.hostname === new URL(env.SUPPORTER_SANDBOX_ORIGIN).hostname &&
    result.action === action
  );
}

// New credentials are generated and saved by the browser BEFORE this call so a
// lost HTTP response cannot lose the only recovery credential for a paid order.
export async function startCheckout(request, env, fetcher = fetch) {
  const origin = checkoutConfig(env);
  if (request.headers.get('Origin') !== origin || new URL(request.url).origin !== origin)
    return json({ error: 'Origin rejected' }, 403);
  const code = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!code) return json({ error: 'Recovery code required' }, 401);
  // No caller-supplied product, price, transaction, customer or return URL.
  // Do not read the body; none of its contents can influence the transaction.
  const hash = await sha256(code),
    db = env.SUPPORTER_DB;
  let intent = await db
    .prepare('SELECT id,transaction_id FROM purchase_intents WHERE recovery_hash=?')
    .bind(hash)
    .first();
  if (intent?.transaction_id) return json({ transaction_id: intent.transaction_id });
  if (!(await checkTurnstile(request, env, fetcher)))
    return json({ error: 'Verification required' }, 403);
  const candidate = crypto.randomUUID(),
    now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO purchase_intents (id,recovery_hash,created_at) VALUES (?,?,?)
    ON CONFLICT(recovery_hash) DO NOTHING`,
    )
    .bind(candidate, hash, now)
    .run();
  intent = await db
    .prepare('SELECT id,transaction_id FROM purchase_intents WHERE recovery_hash=?')
    .bind(hash)
    .first();
  if (intent.transaction_id) return json({ transaction_id: intent.transaction_id });
  await db
    .prepare(
      `INSERT INTO checkout_attempts (intent_id,state,created_at) VALUES (?,'reserved',?)
    ON CONFLICT(intent_id) DO NOTHING`,
    )
    .bind(intent.id, now)
    .run();
  const lock = await db
    .prepare(`UPDATE checkout_attempts SET state='creating' WHERE intent_id=? AND state='reserved'`)
    .bind(intent.id)
    .run();
  if (lock.meta.changes !== 1)
    return json({ error: 'Checkout pending reconciliation; keep your recovery code' }, 409);
  try {
    const response = await fetcher('https://sandbox-api.paddle.com/transactions', {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${env.PADDLE_SANDBOX_API_KEY}`,
        'Content-Type': 'application/json',
        'Paddle-Version': '1',
      },
      body: JSON.stringify({
        items: [{ price_id: PRICE_ID, quantity: 1 }],
        currency_code: 'USD',
        collection_mode: 'automatic',
        custom_data: { actua_checkout_intent: intent.id },
        checkout: { url: `${origin}/api/supporter/checkout` },
      }),
    });
    if (!response.ok) throw new Error('Paddle rejected checkout');
    const { data: transaction } = await response.json();
    const item = transaction?.items?.[0];
    if (
      !/^txn_[a-z0-9]{26}$/.test(transaction?.id ?? '') ||
      !['draft', 'ready'].includes(transaction.status) ||
      transaction.collection_mode !== 'automatic' ||
      transaction.currency_code !== 'USD' ||
      transaction.subscription_id ||
      transaction.discount_id ||
      transaction.items.length !== 1 ||
      item.quantity !== 1 ||
      item.price?.id !== PRICE_ID ||
      item.price.product_id !== PRODUCT_ID ||
      item.price.billing_cycle !== null ||
      item.price.trial_period !== null ||
      item.price.unit_price?.amount !== '299' ||
      item.price.unit_price.currency_code !== 'USD' ||
      transaction.custom_data?.actua_checkout_intent !== intent.id
    ) {
      throw new Error('Unexpected Paddle transaction');
    }
    // Persist mapping and state together BEFORE returning anything to checkout.
    await db.batch([
      db
        .prepare(
          'UPDATE purchase_intents SET transaction_id=? WHERE id=? AND transaction_id IS NULL',
        )
        .bind(transaction.id, intent.id),
      db
        .prepare(
          "UPDATE checkout_attempts SET state='ready' WHERE intent_id=? AND state='creating'",
        )
        .bind(intent.id),
    ]);
    const bound = await db
      .prepare('SELECT transaction_id FROM purchase_intents WHERE id=?')
      .bind(intent.id)
      .first();
    if (bound.transaction_id !== transaction.id) throw new Error('Mapping was not committed');
    return json({ transaction_id: transaction.id });
  } catch {
    // Do not include Paddle response bodies, customer details or credentials in
    // errors. Even a timeout may have created a transaction; never blind retry.
    await db
      .prepare(
        "UPDATE checkout_attempts SET state='reconcile' WHERE intent_id=? AND state='creating'",
      )
      .bind(intent.id)
      .run();
    return json({ error: 'Checkout requires reconciliation; keep your recovery code' }, 503);
  }
}
