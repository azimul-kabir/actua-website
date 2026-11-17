import { entitlement, json } from '../../_lib/supporter.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try { return await entitlement(request, env); }
  catch { return json({ error: 'Entitlement service unavailable' }, 503); }
}
