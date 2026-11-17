import { requireSandbox, sha256, json } from './supporter.js';
import { checkTurnstile } from './checkout.js';
const enc = new TextEncoder();
const emailPattern = /^[^@\s,<>]{1,64}@[a-z0-9.-]+\.[a-z]{2,}$/i;
const active = `JOIN purchases p ON p.transaction_id=i.transaction_id WHERE NOT EXISTS
  (SELECT 1 FROM revocations r WHERE r.transaction_id=p.transaction_id)`;
const queuedMessage = { message: 'If an active purchase matches, a recovery email will be sent.' };
const secretCode = () => to64(crypto.getRandomValues(new Uint8Array(32)));
function to64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
function from64(value) {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c =>
    c.charCodeAt(0),
  );
}

export function recoveryConfig(env) {
  requireSandbox(env);
  if (
    env.SUPPORTER_SANDBOX_RECOVERY_ENABLED !== 'true' ||
    !env.PADDLE_SANDBOX_API_KEY?.startsWith('pdl_sdbx_apikey_') ||
    !env.RESEND_API_KEY ||
    !/^[A-Za-z0-9_-]{43}$/.test(env.SUPPORTER_RECOVERY_ENCRYPTION_KEY ?? '') ||
    !/^[A-Za-z0-9_-]{43,128}$/.test(env.SUPPORTER_RECOVERY_JOB_TOKEN ?? '') ||
    !env.TURNSTILE_SECRET_KEY ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(env.TURNSTILE_SITE_KEY ?? '') ||
    !/^Actua <[^\s<>@]+@notify\.azimulkabir\.com>$/.test(env.SUPPORTER_EMAIL_FROM ?? '')
  ) {
    throw new Error('Recovery disabled');
  }
  const origin = new URL(env.SUPPORTER_SANDBOX_ORIGIN);
  if (origin.protocol !== 'https:' || origin.origin !== env.SUPPORTER_SANDBOX_ORIGIN)
    throw new Error('Invalid origin');
  return origin.origin;
}
async function key(env) {
  return crypto.subtle.importKey(
    'raw',
    from64(env.SUPPORTER_RECOVERY_ENCRYPTION_KEY),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}
export async function encryptJob(payload, env, jobId) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(jobId) },
    await key(env),
    enc.encode(JSON.stringify(payload)),
  );
  return `${to64(iv)}.${to64(encrypted)}`;
}
async function decryptJob(value, env, jobId) {
  const [iv, data] = value.split('.');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: from64(iv), additionalData: enc.encode(jobId) },
    await key(env),
    from64(data),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}
export async function readSmallJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing body');
  let value = '';
  let size = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 2048) {
      await reader.cancel();
      throw new Error('Body too large');
    }
    value += decoder.decode(chunk.value, { stream: true });
  }
  return JSON.parse(value + decoder.decode());
}
function sameOrigin(request, env) {
  return (
    request.headers.get('Origin') === env.SUPPORTER_SANDBOX_ORIGIN &&
    new URL(request.url).origin === env.SUPPORTER_SANDBOX_ORIGIN
  );
}
export async function requestRecovery(request, env, fetcher = fetch, now = Date.now()) {
  recoveryConfig(env);
  if (!sameOrigin(request, env)) return json({ error: 'Origin rejected' }, 403);
  let email;
  try {
    const body = await readSmallJson(request);
    email = body.email?.trim().toLowerCase();
  } catch {
    return json({ error: 'Email required' }, 400);
  }
  if (typeof email !== 'string' || email.length > 254 || !emailPattern.test(email))
    return json({ error: 'Valid email required' }, 400);
  if (!(await checkTurnstile(request, env, fetcher, 'actua-recovery')))
    return json({ error: 'Verification required' }, 403);
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || !/^[a-f0-9:.]{3,64}$/i.test(ip)) throw new Error('Trusted client IP missing');
  const db = env.SUPPORTER_DB,
    hour = Math.floor(now / 3600000);
  // Keyed hashes prevent offline guesses of stored emails/IPs. Generic response
  // is identical for rate-limited, unknown, refunded and active purchases.
  for (const [category, value, limit] of [
    ['ip', ip, 5],
    ['email', email, 3],
  ]) {
    const hash = await sha256(`${env.SUPPORTER_RECOVERY_ENCRYPTION_KEY}:${category}:${value}`);
    const counter = await db
      .prepare(
        `INSERT INTO recovery_limits (bucket_hash,hour,attempts) VALUES (?,?,1)
      ON CONFLICT(bucket_hash,hour) DO UPDATE SET attempts=attempts+1 RETURNING attempts`,
      )
      .bind(hash, hour)
      .first();
    if (counter.attempts > limit) return json(queuedMessage, 202);
  }
  const jobId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO recovery_requests (id,ciphertext,stage,expires_at) VALUES (?,?,'lookup',?)",
    )
    .bind(jobId, await encryptJob({ email }, env, jobId), Math.floor(now / 1000) + 900)
    .run();
  return json(queuedMessage, 202);
}

async function findPurchase(email, env, fetcher) {
  let after;
  // Bound work per attempt; unusually large accounts require operator review.
  for (let page = 0; page < 5; page++) {
    const url = new URL('https://sandbox-api.paddle.com/customers');
    url.searchParams.set('email', email);
    url.searchParams.set('per_page', '200');
    if (after) url.searchParams.set('after', after);
    const response = await fetcher(url.href, {
      headers: { Authorization: `Bearer ${env.PADDLE_SANDBOX_API_KEY}`, 'Paddle-Version': '1' },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw upstreamFailure(response);
    const result = await response.json();
    if (!Array.isArray(result.data)) throw new Error('Invalid customer response');
    const customers = result.data.filter(
      customer =>
        /^ctm_[a-z0-9]{26}$/.test(customer.id ?? '') &&
        customer.email?.trim().toLowerCase() === email &&
        customer.status === 'active',
    );
    // Keep D1 bindings/subrequests bounded even when an email has many customer
    // records. Recovery only needs one active entitlement for these cosmetics.
    for (let offset = 0; offset < customers.length; offset += 50) {
      const group = customers.slice(offset, offset + 50);
      const placeholders = group.map(() => '?').join(',');
      const purchase = await env.SUPPORTER_DB.prepare(
        `SELECT i.id,p.customer_id FROM purchase_intents i ${active}
        AND p.customer_id IN (${placeholders}) ORDER BY i.created_at,i.id LIMIT 1`,
      )
        .bind(...group.map(c => c.id))
        .first();
      // Recipient comes ONLY from Paddle, never the unverified request.
      if (purchase)
        return { intentId: purchase.id, to: group.find(c => c.id === purchase.customer_id).email };
    }
    if (!result.meta?.pagination?.has_more) return null;
    after = result.data.at(-1)?.id;
    if (!after) throw new Error('Invalid customer pagination');
  }
  throw new Error('Customer lookup requires review');
}

function upstreamFailure(response) {
  const error = new Error('Upstream unavailable');
  const value = response.headers.get('Retry-After');
  const seconds =
    value && /^\d+$/.test(value)
      ? Number(value)
      : value
        ? Math.ceil((Date.parse(value) - Date.now()) / 1000)
        : 0;
  error.retryAfter = Number.isFinite(seconds) ? Math.max(60, seconds) : 60;
  return error;
}

export async function sendRecoveryEmail(delivery, jobId, env, fetcher = fetch) {
  const response = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `actua-sandbox-recovery/${jobId}`,
    },
    body: JSON.stringify({
      from: env.SUPPORTER_EMAIL_FROM,
      to: [delivery.to],
      reply_to: 'actua@azimulkabir.com',
      subject: 'Actua sandbox purchase recovery',
      text: `Your Actua sandbox recovery verification code is:\n\n${delivery.token}\n\nIt expires 15 minutes after the recovery request. Enter it on the sandbox recovery page where you requested it. This replaces the old purchase recovery credential.\n\nIf you did not request recovery, ignore this email. Keep this code private. Core budgeting remains free.`,
    }),
  });
  if (!response.ok) throw upstreamFailure(response);
}

export async function processRecovery(env, fetcher = fetch, now = Date.now()) {
  recoveryConfig(env);
  const db = env.SUPPORTER_DB,
    seconds = Math.floor(now / 1000),
    owner = crypto.randomUUID();
  // Purge sensitive payloads/challenges promptly; retain only minimal job state.
  await db
    .prepare(
      "UPDATE recovery_requests SET stage='failed',ciphertext='' WHERE expires_at<=? AND stage NOT IN ('done','failed')",
    )
    .bind(seconds)
    .run();
  await db.prepare('DELETE FROM recovery_challenges WHERE expires_at<=?').bind(seconds).run();
  await db
    .prepare('DELETE FROM recovery_limits WHERE hour<?')
    .bind(Math.floor(now / 3600000) - 1)
    .run();
  await db
    .prepare("DELETE FROM recovery_requests WHERE stage IN ('done','failed') AND expires_at<?")
    .bind(seconds - 86400)
    .run();
  const job = await db
    .prepare(
      `SELECT * FROM recovery_requests WHERE stage IN ('lookup','deliver')
    AND expires_at>? AND lease_until<=? AND attempts<5 ORDER BY expires_at,id LIMIT 1`,
    )
    .bind(seconds, seconds)
    .first();
  if (!job) return false;
  // The random lease owner prevents an expired worker from updating a job that
  // another runner has claimed. Lease exceeds the bounded external operations.
  const lease = `${owner}:${job.id}`;
  // Owner is carried in an independent nullable column (migration adds it).
  const lock = await db
    .prepare(
      `UPDATE recovery_requests SET lease_until=?,lease_owner=?,attempts=attempts+1
    WHERE id=? AND lease_until<=? AND stage=?`,
    )
    .bind(seconds + 60, lease, job.id, seconds, job.stage)
    .run();
  if (lock.meta.changes !== 1) return false;
  try {
    let payload = await decryptJob(job.ciphertext, env, job.id);
    if (job.stage === 'lookup') {
      const purchase = await findPurchase(payload.email, env, fetcher);
      if (!purchase) {
        await db
          .prepare(
            "UPDATE recovery_requests SET stage='done',ciphertext='',lease_until=0 WHERE id=? AND lease_owner=?",
          )
          .bind(job.id, lease)
          .run();
        return true;
      }
      payload = { to: purchase.to, token: secretCode() };
      // Atomically stage the challenge and its encrypted mail payload. A stale
      // runner cannot overwrite another runner's challenge or delivery.
      await db.batch([
        db
          .prepare(
            `INSERT INTO recovery_challenges (token_hash,request_id,intent_id,expires_at)
          SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM recovery_requests WHERE id=? AND lease_owner=?)`,
          )
          .bind(
            await sha256(payload.token),
            job.id,
            purchase.intentId,
            job.expires_at,
            job.id,
            lease,
          ),
        db
          .prepare(
            "UPDATE recovery_requests SET stage='deliver',ciphertext=? WHERE id=? AND lease_owner=?",
          )
          .bind(await encryptJob(payload, env, job.id), job.id, lease),
      ]);
      const owned = await db
        .prepare('SELECT lease_owner FROM recovery_requests WHERE id=?')
        .bind(job.id)
        .first();
      if (owned.lease_owner !== lease) return true;
    }
    const challenge = await db
      .prepare(
        `SELECT c.token_hash FROM recovery_challenges c JOIN purchase_intents i ON i.id=c.intent_id
      ${active} AND c.request_id=? AND c.consumed_at IS NULL AND c.expires_at>?`,
      )
      .bind(job.id, seconds)
      .first();
    if (challenge) await sendRecoveryEmail(payload, job.id, env, fetcher);
    await db
      .prepare(
        "UPDATE recovery_requests SET stage='done',ciphertext='',lease_until=0 WHERE id=? AND lease_owner=?",
      )
      .bind(job.id, lease)
      .run();
    return true;
  } catch (error) {
    const retryAt = seconds + Math.max(60, Number(error?.retryAfter) || 60);
    await db
      .prepare(
        `UPDATE recovery_requests SET lease_until=?,
      stage=CASE WHEN attempts>=5 THEN 'failed' ELSE stage END,
      ciphertext=CASE WHEN attempts>=5 THEN '' ELSE ciphertext END WHERE id=? AND lease_owner=?`,
      )
      .bind(retryAt, job.id, lease)
      .run();
    return true;
  }
}

export async function redeemRecovery(request, env, now = Date.now()) {
  recoveryConfig(env);
  if (!sameOrigin(request, env)) return json({ error: 'Origin rejected' }, 403);
  const token = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  let code;
  try {
    code = (await readSmallJson(request)).recovery_code;
  } catch {}
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(code ?? ''))
    return json({ error: 'Verification code and new recovery code required' }, 400);
  const db = env.SUPPORTER_DB,
    hash = await sha256(token),
    newHash = await sha256(code),
    redemption = crypto.randomUUID(),
    seconds = Math.floor(now / 1000);
  await db.batch([
    db
      .prepare(
        `UPDATE recovery_challenges SET consumed_at=?,redemption_id=? WHERE token_hash=?
      AND consumed_at IS NULL AND expires_at>? AND EXISTS
      (SELECT 1 FROM purchase_intents i ${active} AND i.id=recovery_challenges.intent_id)`,
      )
      .bind(seconds, redemption, hash, seconds),
    db
      .prepare(
        `UPDATE purchase_intents SET recovery_hash=? WHERE id=
      (SELECT intent_id FROM recovery_challenges WHERE token_hash=? AND redemption_id=?)`,
      )
      .bind(newHash, hash, redemption),
    db
      .prepare(
        `UPDATE recovery_challenges SET consumed_at=? WHERE consumed_at IS NULL AND intent_id=
      (SELECT intent_id FROM recovery_challenges WHERE token_hash=? AND redemption_id=?)`,
      )
      .bind(seconds, hash, redemption),
  ]);
  const claimed = await db
    .prepare('SELECT intent_id FROM recovery_challenges WHERE token_hash=? AND redemption_id=?')
    .bind(hash, redemption)
    .first();
  return claimed
    ? json({ recovered: true })
    : json({ error: 'Verification code expired or unavailable' }, 403);
}
