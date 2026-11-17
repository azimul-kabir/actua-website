import { redeemRecovery } from '../../../_lib/recovery.js';
import { json } from '../../../_lib/supporter.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    return await redeemRecovery(request, env);
  } catch {
    return json({ error: 'Sandbox recovery unavailable' }, 503);
  }
}
