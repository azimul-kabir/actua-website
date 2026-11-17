import { purchaseHead, purchaseHeader, purchaseFooter, keyIcon } from './purchase-layout.js';

export function checkoutPage(env) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  // Both public values are format-validated by checkoutConfig before rendering.
  const html = `${purchaseHead('Supporter Extras', nonce)}${purchaseHeader}
<main id="content"><header class="intro"><p class="eyebrow">Supporter Extras</p><h1>A little more you.</h1><p>Personal touches for your budget. A one-time way to support Actua.</p></header>
<div class="flow-layout"><article class="flow-card" aria-label="Purchase steps">
<ol class="progress" aria-label="Your progress"><li id="progress-key" aria-current="step"><span>1</span>Save key</li><li id="progress-pay"><span>2</span>Payment</li><li id="progress-done"><span>3</span>Ready</li></ol>
<section id="key-step">${keyIcon}<h2>Keep your purchase safe</h2><p>Save a private purchase key. It lets you restore this purchase if you change devices.</p><button id="save" class="wide" type="button">Save purchase key</button><label id="save-confirmation" class="confirm" hidden><input id="saved" type="checkbox"> I have saved my purchase key.</label><button id="next-payment" class="wide" type="button" hidden>Continue with saved key</button><p class="help">Keep the file somewhere safe. Anyone with your key can restore your purchase.</p>
<details id="resume"><summary>Already have a purchase key?</summary><label for="recovery">Your saved purchase key</label><input id="recovery" type="password" autocomplete="off" spellcheck="false" aria-describedby="recovery-help"><p id="recovery-help" class="help">Paste it here to resume. Keep using the same key if a payment was interrupted.</p></details>
</section>
<section id="pay-step" hidden><h2>You're ready to check out</h2><p>Your key is saved. Paddle will securely handle your payment and show the final tax before you pay.</p><div id="verification"></div><button id="buy" class="wide" type="button" disabled>Continue to payment</button><p class="test-copy">Use a Paddle test card. This sandbox never charges real money.</p><button id="back-key" type="button" class="text-button">Back to purchase key</button></section>
<section id="done-step" hidden><div class="success-mark" aria-hidden="true">✓</div><h2>Purchase confirmed</h2><p>Your sandbox purchase has been verified. Keep your purchase key for later.</p><a id="return-to-app" class="link-button" href="intent://return#Intent;scheme=actua-supporter-sandbox;package=com.azimulkabir.actua.test;end">Open Actua test app</a><p class="help">In the test app, activate your extras with the purchase key you saved. This requires the sandbox test APK; Actua 2.7.0 cannot activate website purchases.</p></section>
<p id="status" class="status" role="status" aria-live="polite">Save your purchase key to begin.</p>
<div id="check-line"><p class="check-line">Already paid? <button id="check" type="button" class="text-button">Check purchase</button></p><p class="help mobile-restore"><a href="/api/supporter/recovery">Lost your key? Restore with email</a></p></div>
</article><aside class="summary" aria-label="Order summary"><p class="eyebrow">Make Actua yours</p><p class="price">$2.99 <span>USD · once</span></p><p class="help">Plus applicable tax. No subscription.</p><ul><li>Personal app icons</li><li>Accent colors &amp; Catppuccin</li><li>Widget styles</li><li>Celebrations &amp; greetings</li></ul><p class="help restore-link">Lost your purchase key?<br><a href="/api/supporter/recovery">Restore with email</a></p><p class="test-copy">Sandbox preview. Website activation in the Android app is still in development.</p></aside></div><p class="notice">You're trying an unfinished sandbox integration. Website purchases cannot activate extras in Actua 2.7.0 yet.</p></main>${purchaseFooter}<script nonce="${nonce}">
const recovery = document.getElementById('recovery'), saved = document.getElementById('saved');
const buy = document.getElementById('buy'), status = document.getElementById('status');
const valid = code => /^[A-Za-z0-9_-]{43}$/.test(code);
let proof = '', ready = false, busy = false, widget, pollTimer, stage = 'key';
const confirmation = document.getElementById('save-confirmation');
function showStage(next) {
 stage = next;
 for (const step of ['key','pay','done']) {
  document.getElementById(step+'-step').hidden = step !== next;
  const item = document.getElementById('progress-'+step);
  if (step === next) item.setAttribute('aria-current','step'); else item.removeAttribute('aria-current');
 }
 document.getElementById('check-line').hidden = next === 'done';
 mountVerification(); update();
 const heading = document.querySelector('#'+next+'-step h2'); heading.tabIndex = -1; heading.focus();
}
document.getElementById('back-key').addEventListener('click',()=>{showStage('key');document.getElementById('save').focus();});
const storageKey = 'actua-sandbox-recovery';
// Never accept a caller's _ptxn or success query as an instruction to open or activate.
history.replaceState(null, '', location.pathname);
try { recovery.value = sessionStorage.getItem(storageKey) || ''; } catch {}
if (!valid(recovery.value)) recovery.value = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/, '');
function remember() { try { sessionStorage.setItem(storageKey, recovery.value); } catch {} }
function update() { buy.disabled = stage !== 'pay' || !ready || !proof || !saved.checked || !valid(recovery.value) || busy; document.getElementById('check').disabled = busy; saved.disabled = busy; document.getElementById('back-key').disabled = busy; document.getElementById('save').disabled = busy; const next = document.getElementById('next-payment'); next.hidden = stage !== 'key' || !saved.checked || !valid(recovery.value); next.disabled = busy; }
remember();
recovery.addEventListener('input', () => { saved.checked = false; confirmation.hidden = !valid(recovery.value); clearTimeout(pollTimer); remember(); update(); });
document.getElementById('next-payment').addEventListener('click', () => { if (!saved.checked || !valid(recovery.value) || busy) return; showStage('pay'); status.textContent = 'Continue when verification is ready.'; });
saved.addEventListener('change', () => {
 if (saved.checked && valid(recovery.value)) { showStage('pay'); status.textContent = ready ? 'Your purchase key is saved. Continue when verification is ready.' : 'Loading secure payment…'; }
 else showStage('key');
 update();
});
document.getElementById('save').addEventListener('click', () => {
 if (!valid(recovery.value)) { status.textContent = 'Enter a valid purchase key, or reload to create a new one.'; return; }
 const url = URL.createObjectURL(new Blob([recovery.value], {type:'text/plain'}));
 const link = document.createElement('a'); link.href = url; link.download = 'actua-sandbox-recovery.txt'; link.click();
 document.getElementById('save').classList.add('secondary'); document.getElementById('save').textContent = 'Save another copy'; confirmation.hidden = false; status.textContent = 'After saving the file, confirm below to continue.';
 setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function loadScript(src) { return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.append(script); }); }
function mountVerification() {
 if (!ready || stage !== 'pay' || widget !== undefined) return;
  widget = turnstile.render('#verification', {sitekey:'${env.TURNSTILE_SITE_KEY}',action:'actua-checkout',callback:token => { proof = token; update(); },'expired-callback':() => {proof='';update();},'error-callback':() => {proof='';update();}});
}
async function checkPurchase(remaining = 0) {
 clearTimeout(pollTimer);
 const code = recovery.value;
 if (!valid(code)) { status.textContent = 'Open “Already have a purchase key?” and paste your saved key.'; return; }
 try {
  const response = await fetch('/api/supporter/entitlement', {method:'POST',headers:{Authorization:'Bearer '+code},cache:'no-store',redirect:'error'});
  if (code !== recovery.value) return;
  if (response.ok) {
   const result = await response.json();
   if (typeof result.entitlement !== 'string') throw new Error();
   // Deliberately do not persist or apply extras from browser state. Android
   // must independently verify the signed entitlement in its own integration.
   showStage('done'); status.textContent = 'Verified securely by Actua.';
  } else if (response.status === 403 && remaining > 0) {
   status.textContent = 'Confirming your payment… You can safely check again if this takes a moment.';
   pollTimer = setTimeout(() => checkPurchase(remaining - 1), 2000);
  } else status.textContent = 'No active purchase was found for this key. If you just paid, wait a moment and check again.';
 } catch { status.textContent = 'We couldn’t check your purchase. Your key is safe in this tab; try again in a moment.'; }
}
document.getElementById('check').addEventListener('click', () => checkPurchase());
buy.addEventListener('click', async () => {
 if (buy.disabled) return;
 busy = true; recovery.disabled = true; update(); status.textContent = 'Opening secure payment…';
 try {
  const response = await fetch('/api/supporter/checkout', {method:'POST',headers:{Authorization:'Bearer '+recovery.value,'X-Turnstile-Token':proof},cache:'no-store',redirect:'error'});
  const result = await response.json();
  if (!response.ok) { status.textContent = response.status === 409 || response.status === 503 ? 'Your checkout needs a check before it can continue. Keep this purchase key and contact us; do not start another order.' : 'We couldn’t open checkout. Keep this key and try again after verification.'; return; }
  if (!/^txn_[a-z0-9]{26}$/.test(result.transaction_id)) throw new Error();
  Paddle.Checkout.open({transactionId:result.transaction_id,settings:{showAddDiscounts:false,showAddTaxId:false}});
  status.textContent = 'Finish your test payment in Paddle. We’ll confirm it here automatically.';
 } catch { status.textContent = 'Payment could not be opened. Keep your key and try again with the same key.'; }
 finally { busy = false; recovery.disabled = false; proof = ''; if (widget !== undefined) turnstile.reset(widget); update(); }
});
(async () => {
 try {
  await loadScript('https://cdn.paddle.com/paddle/v2/paddle.js');
  Paddle.Environment.set('sandbox');
  Paddle.Initialize({token:'${env.PADDLE_SANDBOX_CLIENT_TOKEN}',eventCallback:event => {
   if (event.name === 'checkout.completed') { status.textContent = 'Confirming your payment…'; checkPurchase(30); }
   if (event.name === 'checkout.payment.failed' || event.name === 'checkout.error') status.textContent = 'Payment didn’t complete. Your key is safe; you can retry this checkout.';
  }});
  await loadScript('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  ready = true; mountVerification(); if (stage === 'pay') status.textContent = 'Your key is saved. Continue when verification is ready.'; update();
 } catch { status.textContent = 'Secure checkout couldn’t load. Keep your key and reload this page to try again.'; }
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
