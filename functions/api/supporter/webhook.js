import { requireSandbox, verifyWebhook, fulfill, json } from '../../_lib/supporter.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    requireSandbox(env);
    // Bound input size even without Content-Length (streamed requests).
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Missing body');
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) { await reader.cancel(); throw new Error('Body too large'); }
      chunks.push(value);
    }
    const raw = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
    await verifyWebhook(raw, request.headers.get('Paddle-Signature'), env.PADDLE_NOTIFICATION_WEBHOOK_SECRET);
    await fulfill(env.SUPPORTER_DB, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
    return json({ received: true });
  } catch {
    // Never log payloads, headers, secrets or customer details. Non-2xx permits retry.
    return json({ error: 'Webhook not processed' }, 503);
  }
}
