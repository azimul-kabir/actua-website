const enc = new TextEncoder();
export const PRODUCT_ID = 'pro_01m7m61sqqhjfgcvc7hvawt8pf';
export const PRICE_ID = 'pri_01m7m61ssadksxp8jevddmtmhf';
export const ISSUER = 'https://actua.azimulkabir.com/paddle-sandbox';
export const AUDIENCE = 'actua-supporter-sandbox';
export const TOKEN_LIFETIME = 24 * 60 * 60;

export function json(body, status = 200) {
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}
export function requireSandbox(env) {
  if (env.PADDLE_ENVIRONMENT !== 'sandbox' || env.SUPPORTER_SANDBOX_ENABLED !== 'true' || !env.SUPPORTER_DB) {
    throw new Error('Sandbox backend disabled');
  }
}
export async function sha256(value) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}
function hex(bytes) {
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

// Verify the exact bytes received; repeated h1 fields support secret rotation.
export async function verifyWebhook(raw, header, secret, now = Date.now()) {
  if (!secret || !header || !raw.byteLength) throw new Error('Missing webhook inputs');
  const fields = header.split(';').map(x => x.trim().split('='));
  const stamps = fields.filter(([k]) => k === 'ts');
  if (stamps.length !== 1 || !/^\d+$/.test(stamps[0][1])) throw new Error('Invalid timestamp');
  const ts = stamps[0][1];
  if (Math.abs(Math.floor(now / 1000) - Number(ts)) > 5) throw new Error('Expired signature');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const prefix = enc.encode(`${ts}:`);
  const message = new Uint8Array(prefix.length + raw.byteLength);
  message.set(prefix); message.set(new Uint8Array(raw), prefix.length);
  for (const [name, signature] of fields) {
    if (name !== 'h1' || !/^[a-fA-F0-9]{64}$/.test(signature ?? '')) continue;
    const bytes = Uint8Array.from(signature.match(/../g), x => parseInt(x, 16));
    if (await crypto.subtle.verify('HMAC', key, bytes, message)) return;
  }
  throw new Error('Invalid signature');
}

function id(value, prefix) {
  return typeof value === 'string' && new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value);
}
export async function fulfill(db, event) {
  if (!id(event?.event_id, 'evt') || typeof event.event_type !== 'string' ||
      !Number.isFinite(Date.parse(event.occurred_at)) || !event.data) throw new Error('Malformed event');
  const d = event.data;
  const statements = [];
  if (event.event_type === 'transaction.completed') {
    // Only the exact single-item, one-time USD catalog purchase qualifies.
    const item = d.items?.[0];
    const price = item?.price;
    const eligible = d.status === 'completed' && !d.subscription_id &&
      d.currency_code === 'USD' && d.items.length === 1 && item.quantity === 1 &&
      price?.id === PRICE_ID && price.product_id === PRODUCT_ID &&
      price.unit_price?.amount === '299' && price.unit_price.currency_code === 'USD' &&
      price.billing_cycle === null && price.trial_period === null && !d.discount_id;
    if (eligible) {
      if (!id(d.id, 'txn') || !id(d.customer_id, 'ctm')) throw new Error('Malformed purchase');
      statements.push(db.prepare(`INSERT INTO purchases
        (transaction_id,customer_id,product_id,price_id,completed_at) VALUES (?,?,?,?,?)
        ON CONFLICT(transaction_id) DO NOTHING`).bind(d.id, d.customer_id, PRODUCT_ID, PRICE_ID, event.occurred_at));
    }
  } else if (['adjustment.created', 'adjustment.updated'].includes(event.event_type)) {
    // A pending/rejected refund must not revoke. For this single-item SKU, ANY
    // approved refund or chargeback revokes; reversal requires manual review.
    if (d.status === 'approved' && ['refund', 'chargeback'].includes(d.action)) {
      if (!id(d.id, 'adj') || !id(d.transaction_id, 'txn')) throw new Error('Malformed adjustment');
      statements.push(db.prepare(`INSERT INTO revocations
        (adjustment_id,transaction_id,action,occurred_at) VALUES (?,?,?,?)
        ON CONFLICT(adjustment_id) DO NOTHING`).bind(d.id, d.transaction_id, d.action, event.occurred_at));
    }
  }
  statements.push(db.prepare(`INSERT INTO processed_events (event_id,event_type,occurred_at)
    VALUES (?,?,?) ON CONFLICT(event_id) DO NOTHING`).bind(event.event_id, event.event_type, event.occurred_at));
  // D1 batch is a transaction: a failed statement rolls back effects AND ledger.
  // Each effect is independently idempotent, including concurrent deliveries.
  await db.batch(statements);
}

// Internal helpers for the next checkout slice. Never expose either operation
// as a browser-supplied transaction/intent binding endpoint.
export async function createIntent(db, now = Date.now()) {
  const intentId = crypto.randomUUID();
  const recoveryCode = base64url(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare('INSERT INTO purchase_intents (id,recovery_hash,created_at) VALUES (?,?,?)')
    .bind(intentId, await sha256(recoveryCode), Math.floor(now / 1000)).run();
  return { intentId, recoveryCode };
}
export async function bindTransaction(db, intentId, transactionId) {
  if (!id(transactionId, 'txn')) throw new Error('Invalid transaction ID');
  const result = await db.prepare(`UPDATE purchase_intents SET transaction_id=?
    WHERE id=? AND transaction_id IS NULL`).bind(transactionId, intentId).run();
  if (result.meta.changes !== 1) throw new Error('Intent already bound or missing');
}

export async function signEntitlement(subject, env, now = Date.now()) {
  const jwk = JSON.parse(env.SUPPORTER_SIGNING_JWK);
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !env.SUPPORTER_SIGNING_KEY_ID) {
    throw new Error('Invalid signing configuration');
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const iat = Math.floor(now / 1000);
  const claims = { iss: ISSUER, aud: AUDIENCE, sub: subject, iat, nbf: iat,
    exp: iat + TOKEN_LIFETIME, environment: 'sandbox', extras: ['supporter'] };
  const encode = value => base64url(enc.encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: 'ES256', typ: 'JWT', kid: env.SUPPORTER_SIGNING_KEY_ID })}.${encode(claims)}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned));
  return `${unsigned}.${base64url(signature)}`;
}

export async function entitlement(request, env) {
  requireSandbox(env);
  const code = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!code) return json({ error: 'Purchase recovery code required' }, 401);
  // One atomic query observes both completion and revocation. No client IDs or
  // redirect parameters can create ownership. A code is a bearer credential.
  const row = await env.SUPPORTER_DB.prepare(`SELECT i.id FROM purchase_intents i
    JOIN purchases p ON p.transaction_id=i.transaction_id
    WHERE i.recovery_hash=? AND NOT EXISTS
      (SELECT 1 FROM revocations r WHERE r.transaction_id=p.transaction_id)`)
    .bind(await sha256(code)).first();
  if (!row) return json({ error: 'Purchase not active' }, 403);
  return json({ entitlement: await signEntitlement(row.id, env), expires_in: TOKEN_LIFETIME });
}
