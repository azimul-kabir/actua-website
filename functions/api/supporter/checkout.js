import { startCheckout, checkoutConfig } from '../../_lib/checkout.js';
import { checkoutPage } from '../../_lib/checkout-page.js';
import { json } from '../../_lib/supporter.js';

export async function onRequest({ request, env }) {
  try {
    if (request.method === 'POST') return await startCheckout(request, env);
    if (request.method === 'GET') {
      const origin = checkoutConfig(env);
      if (new URL(request.url).origin !== origin)
        return json({ error: 'Preview origin required' }, 403);
      return checkoutPage(env);
    }
    return json({ error: 'Method not allowed' }, 405);
  } catch {
    return json({ error: 'Sandbox checkout unavailable' }, 503);
  }
}
