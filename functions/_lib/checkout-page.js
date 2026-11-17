export function checkoutPage(env) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  // Both public values are format-validated by checkoutConfig before rendering.
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Actua sandbox checkout</title>
<style nonce="${nonce}">
body{font:17px/1.6 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1.25rem;background:#faf9ff;color:#242130}
h1{line-height:1.15}label{display:block;margin:1rem 0}input[type=password]{box-sizing:border-box;width:100%;padding:.7rem;font:inherit}
button{padding:.7rem 1rem;font:inherit;cursor:pointer}button:disabled{cursor:default}#status{min-height:3rem}a{color:#4b18d1}
</style></head><body><main>
<p>Actua · Test mode</p><h1>Supporter Extras sandbox</h1>
<p>US$2.99 once, plus applicable tax. This checkout uses test payments only.
Actua 2.7.0 cannot activate website purchases yet. Core budgeting stays free.</p>
<ol><li>Save your recovery code before starting. Keep it private: anyone with it can recover this sandbox purchase.</li>
<li>Complete the verification and use a Paddle sandbox test card.</li>
<li>Wait for the server to verify the purchase. A checkout success screen does not prove activation.</li></ol>
<label for="recovery">Recovery code (paste a saved code to resume)</label>
<input id="recovery" type="password" autocomplete="off" spellcheck="false" aria-describedby="recovery-help">
<p id="recovery-help">The code stays in this tab's session. Save a copy before closing it. Email recovery requires separate service configuration.</p>
<button id="save" type="button">Save recovery code</button>
<label><input id="saved" type="checkbox"> I saved this recovery code securely.</label>
<div id="verification"></div>
<p><button id="buy" type="button" disabled>Open test checkout</button> <button id="check" type="button">Check purchase</button></p>
<p id="status" role="status" aria-live="polite">Loading sandbox checkout…</p>
<p><a href="/api/supporter/recovery">Email recovery</a> · <a href="/support">Supporter Extras</a> · <a href="/refund">Refunds</a> · <a href="/contact">Contact</a></p>
</main><script nonce="${nonce}">
const recovery = document.getElementById('recovery'), saved = document.getElementById('saved');
const buy = document.getElementById('buy'), status = document.getElementById('status');
const valid = code => /^[A-Za-z0-9_-]{43}$/.test(code);
let proof = '', ready = false, busy = false, widget, pollTimer;
const storageKey = 'actua-sandbox-recovery';
// Never accept a caller's _ptxn or success query as an instruction to open or activate.
history.replaceState(null, '', location.pathname);
try { recovery.value = sessionStorage.getItem(storageKey) || ''; } catch {}
if (!valid(recovery.value)) recovery.value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
function remember() { try { sessionStorage.setItem(storageKey, recovery.value); } catch {} }
function update() { buy.disabled = !ready || !proof || !saved.checked || !valid(recovery.value) || busy; }
remember();
recovery.addEventListener('input', () => { saved.checked = false; clearTimeout(pollTimer); remember(); update(); });
saved.addEventListener('change', update);
document.getElementById('save').addEventListener('click', () => {
 if (!valid(recovery.value)) { status.textContent = 'Enter a valid recovery code first.'; return; }
 const url = URL.createObjectURL(new Blob([recovery.value], {type:'text/plain'}));
 const link = document.createElement('a'); link.href = url; link.download = 'actua-sandbox-recovery.txt'; link.click();
 setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function loadScript(src) { return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.append(script); }); }
async function checkPurchase(remaining = 0) {
 clearTimeout(pollTimer);
 const code = recovery.value;
 if (!valid(code)) { status.textContent = 'Enter your saved recovery code.'; return; }
 try {
  const response = await fetch('/api/supporter/entitlement', {method:'POST',headers:{Authorization:'Bearer '+code},cache:'no-store',redirect:'error'});
  if (code !== recovery.value) return;
  if (response.ok) {
   const result = await response.json();
   if (typeof result.entitlement !== 'string') throw new Error();
   // Deliberately do not persist or apply extras from browser state. Android
   // must independently verify the signed entitlement in its own integration.
   status.textContent = 'Sandbox purchase verified by the server. Website activation in the Android app is still in development.';
  } else if (response.status === 403 && remaining > 0) {
   status.textContent = 'Waiting for the verified payment webhook…';
   pollTimer = setTimeout(() => checkPurchase(remaining - 1), 2000);
  } else status.textContent = 'No active verified purchase yet. Keep your recovery code and check again later.';
 } catch { status.textContent = 'Unable to check the purchase. Keep your code and try again later.'; }
}
document.getElementById('check').addEventListener('click', () => checkPurchase());
buy.addEventListener('click', async () => {
 if (buy.disabled) return;
 busy = true; recovery.disabled = true; update(); status.textContent = 'Preparing sandbox checkout…';
 try {
  const response = await fetch('/api/supporter/checkout', {method:'POST',headers:{Authorization:'Bearer '+recovery.value,'X-Turnstile-Token':proof},cache:'no-store',redirect:'error'});
  const result = await response.json();
  if (!response.ok) { status.textContent = result.error || 'Checkout unavailable. Keep your recovery code.'; return; }
  if (!/^txn_[a-z0-9]{26}$/.test(result.transaction_id)) throw new Error();
  Paddle.Checkout.open({transactionId:result.transaction_id,settings:{showAddDiscounts:false,showAddTaxId:false}});
  status.textContent = 'Complete the sandbox payment, then wait for verification.';
 } catch { status.textContent = 'Checkout could not be opened. Keep your recovery code; retry with the same code.'; }
 finally { busy = false; recovery.disabled = false; proof = ''; if (widget !== undefined) turnstile.reset(widget); update(); }
});
(async () => {
 try {
  await loadScript('https://cdn.paddle.com/paddle/v2/paddle.js');
  Paddle.Environment.set('sandbox');
  Paddle.Initialize({token:'${env.PADDLE_SANDBOX_CLIENT_TOKEN}',eventCallback:event => {
   if (event.name === 'checkout.completed') { status.textContent = 'Checkout finished. Waiting for server verification…'; checkPurchase(30); }
   if (event.name === 'checkout.payment.failed' || event.name === 'checkout.error') status.textContent = 'Payment did not complete. You can try the same checkout again.';
  }});
  await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  widget = turnstile.render('#verification', {sitekey:'${env.TURNSTILE_SITE_KEY}',action:'actua-checkout',callback:token => { proof = token; update(); },'expired-callback':() => {proof='';update();},'error-callback':() => {proof='';update();}});
  ready = true; status.textContent = 'Save your recovery code, then complete the verification.'; update();
 } catch { status.textContent = 'Sandbox checkout could not load. Please try again later.'; }
})();
</script></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      // Paddle positions its overlay using style attributes. Keep script and
      // style elements nonce-protected; allow attributes only on this test page.
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' https://cdn.paddle.com https://challenges.cloudflare.com; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; connect-src 'self' https://*.paddle.com https://challenges.cloudflare.com; frame-src https://*.paddle.com https://challenges.cloudflare.com; img-src 'self' data: https://*.paddle.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    },
  });
}
