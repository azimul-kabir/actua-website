import { purchaseHead, purchaseHeader, purchaseFooter, keyIcon } from './purchase-layout.js';

export function recoveryPage(env) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  return new Response(
    `${purchaseHead('Restore your purchase', nonce)}${purchaseHeader}
<main id="content" class="recovery"><header class="intro"><p class="eyebrow">Welcome back</p><h1>Restore your purchase.</h1><p>Lost your purchase key? We'll help you get back in.</p></header>
<article class="flow-card" aria-label="Recovery steps"><ol class="progress" aria-label="Your progress"><li id="progress-email" aria-current="step"><span>1</span>Email</li><li id="progress-verify"><span>2</span>Verify</li><li id="progress-key"><span>3</span>Save key</li></ol>
<section id="email-step"><h2>Where should we send your code?</h2><p class="muted">Use the email address you entered at checkout.</p><form id="request-form"><label for="email">Purchase email</label><input id="email" type="email" autocomplete="email" maxlength="254" required><div id="verification"></div><button id="request" type="submit" class="wide" disabled>Send recovery email</button></form><p class="help">We'll send a private code if an active purchase matches. Check your spam folder too.</p><details><summary>I already have an email code</summary><p>You can continue with an unexpired code you requested earlier.</p><button id="have-code" type="button" class="secondary">Enter email code</button></details></section>
<section id="verify-step" hidden><h2>Check your inbox</h2><p class="email-note">If an active purchase matches, a recovery email will be sent. Use the newest email; its code expires in 15 minutes.</p><form id="verify-form"><label for="challenge">Code from your email</label><input id="challenge" type="password" autocomplete="off" spellcheck="false" required aria-describedby="challenge-help"><p id="challenge-help" class="help">Copy and paste the full code from the email. Keep it private.</p><button id="continue" type="submit" class="wide">Continue</button></form><button id="resend" type="button" class="text-button edit-email">Need another email?</button></section>
<section id="key-step" hidden>${keyIcon}<h2>Save your new purchase key</h2><p>This replaces your old key after restoration. Save it somewhere safe before continuing.</p><button id="save" type="button" class="wide">Save new purchase key</button><label id="save-confirmation" class="confirm" hidden><input id="saved" type="checkbox"> I have saved my new purchase key.</label><p class="help">Anyone with this file can restore your purchase. Don't share it.</p><details><summary>About your purchase key</summary><p>Your purchase key is different from the email code. Keep this file for future devices. It stays in this tab while you finish.</p><label for="new-code">New purchase key</label><input id="new-code" type="password" autocomplete="off" readonly></details><div class="actions" id="restore-actions" hidden><button id="redeem" type="button" class="wide" disabled>Restore purchase</button><button id="back-verify" type="button" class="text-button">Back to email code</button></div></section>
<section id="done-step" hidden><div class="success-mark" aria-hidden="true">✓</div><h2>You're all set</h2><p>Your purchase is restored. Your new key now replaces the old one.</p><a class="link-button" href="/api/supporter/checkout">Check my purchase</a><p class="notice">Android activation is still being built. Actua 2.7.0 cannot use website purchases yet.</p></section>
<p id="interrupted" class="help" hidden>Already tried restoring? <a id="check-saved" href="/api/supporter/checkout">Check with your saved new key</a> before requesting another email.</p>
<p id="status" class="status" role="status" aria-live="polite">Loading secure verification…</p></article><p class="help"><a href="/api/supporter/checkout">Back to Supporter Extras</a></p><p class="notice">Sandbox preview. Recovery applies only to active test purchases. No real charges.</p></main>${purchaseFooter}
<script nonce="${nonce}">
history.replaceState(null,'',location.pathname);
const status=document.getElementById('status'), email=document.getElementById('email'), challenge=document.getElementById('challenge');
const code=document.getElementById('new-code'),saved=document.getElementById('saved'),requestButton=document.getElementById('request'),redeemButton=document.getElementById('redeem');
const confirmation=document.getElementById('save-confirmation');
let proof='',widget,busy=false,stage='email'; const valid=value=>/^[A-Za-z0-9_-]{43}$/.test(value);
try { code.value=sessionStorage.getItem('actua-sandbox-replacement') || ''; } catch {}
if(!valid(code.value)) code.value=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
try { sessionStorage.setItem('actua-sandbox-replacement',code.value); } catch {}
function showStage(next){
 stage=next;
 for(const step of ['email','verify','key','done']) document.getElementById(step+'-step').hidden=step!==next;
 for(const step of ['email','verify','key']) {
  const item=document.getElementById('progress-'+step);
  if(step===next)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
 }
 update();
 const heading=document.querySelector('#'+next+'-step h2');heading.tabIndex=-1;heading.focus();
}
function update(){
 requestButton.disabled=busy || !proof;
 redeemButton.disabled=stage!=='key' || busy || !saved.checked || !valid(challenge.value) || !valid(code.value);
 for(const id of ['continue','resend','back-verify','have-code','save'])document.getElementById(id).disabled=busy;
 challenge.disabled=busy;email.disabled=busy;saved.disabled=busy;
}
saved.addEventListener('change',update);challenge.addEventListener('input',()=>{challenge.removeAttribute('aria-invalid');update();});
document.getElementById('have-code').addEventListener('click',()=>{showStage('verify');status.textContent='Paste the newest code from your email.';challenge.focus();});
document.getElementById('resend').addEventListener('click',()=>{showStage('email');if(widget!==undefined)turnstile.reset(widget);status.textContent='Check your email address, then request a new email.';email.focus();});
document.getElementById('back-verify').addEventListener('click',()=>{showStage('verify');status.textContent='Check the full code from your latest email.';challenge.focus();});
document.getElementById('verify-form').addEventListener('submit',event=>{
 event.preventDefault();challenge.value=challenge.value.trim();
 if(!valid(challenge.value)){challenge.setAttribute('aria-invalid','true');status.textContent='Paste the full code from your email, without spaces.';challenge.focus();return;}
 showStage('key');status.textContent='Save your new key, then confirm the file is saved.';
});
document.getElementById('save').addEventListener('click',()=>{
 const url=URL.createObjectURL(new Blob([code.value],{type:'text/plain'}));const link=document.createElement('a');link.href=url;link.download='actua-sandbox-recovery.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 document.getElementById('save').classList.add('secondary');document.getElementById('save').textContent='Save another copy';document.getElementById('restore-actions').hidden=false;confirmation.hidden=false;status.textContent='After saving the file, confirm below to restore your purchase.';
});
document.getElementById('request-form').addEventListener('submit',async event=>{
 event.preventDefault();if(requestButton.disabled)return;
 busy=true;update();status.textContent='Requesting your recovery email…';
 try {
  const response=await fetch('/api/supporter/recovery',{method:'POST',headers:{'Content-Type':'application/json','X-Turnstile-Token':proof},body:JSON.stringify({email:email.value}),cache:'no-store',redirect:'error'});
  if(response.status===202){showStage('verify');status.textContent='If an active purchase matches, a recovery email will be sent. Check your inbox and spam folder.';}
  else status.textContent='We couldn’t request an email. Check the address and verification, then try again.';
 }catch{status.textContent='We couldn’t connect. Check your connection and try again.';}
 finally{busy=false;proof='';if(widget!==undefined)turnstile.reset(widget);update();}
});
document.getElementById('check-saved').addEventListener('click',()=>{try{sessionStorage.setItem('actua-sandbox-recovery',code.value);}catch{}});
redeemButton.addEventListener('click',async()=>{
 if(redeemButton.disabled)return;
 busy=true;update();status.textContent='Restoring your purchase…';
 try{
  const response=await fetch('/api/supporter/recovery/redeem',{method:'POST',headers:{Authorization:'Bearer '+challenge.value,'Content-Type':'application/json'},body:JSON.stringify({recovery_code:code.value}),cache:'no-store',redirect:'error'});
  if(response.ok){
   challenge.value='';try{sessionStorage.setItem('actua-sandbox-recovery',code.value);sessionStorage.removeItem('actua-sandbox-replacement');}catch{}
   document.getElementById('interrupted').hidden=true;showStage('done');status.textContent='Recovery verified. Your saved new key now replaces the old one.';
  }else{
   document.getElementById('interrupted').hidden=false;
   showStage('verify');status.textContent='This email code may be expired or already used. Request a new email. If you already tried restoring, check your purchase with the new key you saved.';
  }
 }catch{document.getElementById('interrupted').hidden=false;status.textContent='The response was interrupted. Check with your saved new key before requesting another email.';}
 finally{busy=false;update();}
});
const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
script.onload=()=>{widget=turnstile.render('#verification',{sitekey:'${env.TURNSTILE_SITE_KEY}',action:'actua-recovery',callback:token=>{proof=token;update();},'expired-callback':()=>{proof='';update();},'error-callback':()=>{proof='';update();}});if(stage==='email')status.textContent='';};
script.onerror=()=>{status.textContent='Secure verification couldn’t load. Reload this page to try again.';};document.head.append(script);
</script></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; style-src 'nonce-${nonce}'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    },
  );
}
