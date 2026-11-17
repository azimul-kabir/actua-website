import { requestRecovery, recoveryConfig, processRecovery } from '../../_lib/recovery.js';
import { recoveryPage } from '../../_lib/recovery-page.js';
import { json } from '../../_lib/supporter.js';
export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'GET') {
      if (new URL(request.url).origin !== recoveryConfig(env))
        return json({ error: 'Preview origin required' }, 403);
      return recoveryPage(env);
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const result = await requestRecovery(request, env);
    if (result.status === 202 && context.waitUntil)
      context.waitUntil(processRecovery(env).catch(() => {}));
    return result;
  } catch {
    return json({ error: 'Sandbox recovery unavailable' }, 503);
  }
}
