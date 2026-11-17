import { recoveryConfig, processRecovery } from '../../../_lib/recovery.js';
import { json } from '../../../_lib/supporter.js';
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    recoveryConfig(env);
    if (request.headers.get('Authorization') !== `Bearer ${env.SUPPORTER_RECOVERY_JOB_TOKEN}`)
      return json({ error: 'Unauthorized' }, 401);
    const processed = await processRecovery(env);
    return json({ processed });
  } catch {
    return json({ error: 'Recovery runner unavailable' }, 503);
  }
}
