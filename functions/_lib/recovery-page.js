export function recoveryPage(env) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recover an Actua sandbox purchase</title><style nonce="${nonce}">
body{font:17px/1.6 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1.25rem;background:#faf9ff;color:#242130}
label{display:block;margin-top:1rem}input:not([type=checkbox]){box-sizing:border-box;width:100%;padding:.6rem;font:inherit}button{font:inherit;padding:.6rem;margin-top:.8rem}#status{min-height:3rem}a{color:#4b18d1}
</style></head><body><main><p>Actua · Test mode</p><h1>Recover a sandbox purchase</h1>
<p>Use the email address entered at checkout. Recovery applies only to active sandbox purchases. Actua 2.7.0 cannot activate website purchases yet.</p>
<label for="email">Purchase email</label><input id="email" type="email" autocomplete="email" maxlength="254">
<div id="verification"></div><button id="request" disabled>Request email code</button>
<h2>Replace your lost recovery code</h2><p>Save the new recovery code before verifying the email code. Keep both codes private.</p>
<label for="new-code">New recovery code</label><input id="new-code" type="password" autocomplete="off" readonly>
<button id="save">Save new recovery code</button>
<label><input id="saved" type="checkbox"> I saved the new recovery code securely.</label>
<label for="challenge">Verification code from your email</label><input id="challenge" type="password" autocomplete="off" spellcheck="false">
<button id="redeem" disabled>Recover purchase</button><p id="status" role="status" aria-live="polite">Loading verification…</p>
<p><a href="/api/supporter/checkout">Return to sandbox checkout</a></p></main>
<script nonce="${nonce}">
history.replaceState(null,'',location.pathname);
const status=document.getElementById('status'), email=document.getElementById('email'), challenge=document.getElementById('challenge');
const code=document.getElementById('new-code'),saved=document.getElementById('saved'),requestButton=document.getElementById('request'),redeemButton=document.getElementById('redeem');
let proof='',widget,busy=false; const valid=value=>/^[A-Za-z0-9_-]{43}$/.test(value);
try { code.value=sessionStorage.getItem('actua-sandbox-replacement') || ''; } catch {}
if(!valid(code.value)) code.value=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
try { sessionStorage.setItem('actua-sandbox-replacement',code.value); } catch {}
function update(){requestButton.disabled=busy || !proof;redeemButton.disabled=busy || !saved.checked || !valid(challenge.value);}
saved.addEventListener('change',update);challenge.addEventListener('input',update);
document.getElementById('save').addEventListener('click',()=>{
 const url=URL.createObjectURL(new Blob([code.value],{type:'text/plain'}));const link=document.createElement('a');link.href=url;link.download='actua-sandbox-recovery.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
requestButton.addEventListener('click',async()=>{
 busy=true;update();
 try {
  const response=await fetch('/api/supporter/recovery',{method:'POST',headers:{'Content-Type':'application/json','X-Turnstile-Token':proof},body:JSON.stringify({email:email.value}),cache:'no-store',redirect:'error'});
  status.textContent=response.status===202?'If an active purchase matches, a recovery email will be sent. Check your inbox and spam folder.':'Recovery request unavailable. Check your email address and verification, then try later.';
 }catch{status.textContent='Recovery service unavailable. Try later.';}
 finally{busy=false;proof='';if(widget!==undefined)turnstile.reset(widget);update();}
});
redeemButton.addEventListener('click',async()=>{
 busy=true;update();
 try{
  const response=await fetch('/api/supporter/recovery/redeem',{method:'POST',headers:{Authorization:'Bearer '+challenge.value,'Content-Type':'application/json'},body:JSON.stringify({recovery_code:code.value}),cache:'no-store',redirect:'error'});
  if(response.ok){challenge.value='';try{sessionStorage.setItem('actua-sandbox-recovery',code.value);sessionStorage.removeItem('actua-sandbox-replacement');}catch{}status.textContent='Recovery verified. Your saved new code now replaces the old one. Return to sandbox checkout to check the purchase.';}
  else status.textContent='Verification could not be completed. The email code may be expired or already used. If a previous response was interrupted, check the purchase with your saved new recovery code.';
 }catch{status.textContent='Response interrupted. Keep your saved new recovery code; check the purchase with it before requesting another email.';}
 finally{busy=false;update();}
});
const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
script.onload=()=>{widget=turnstile.render('#verification',{sitekey:'${env.TURNSTILE_SITE_KEY}',action:'actua-recovery',callback:token=>{proof=token;update();},'expired-callback':()=>{proof='';update();},'error-callback':()=>{proof='';update();}});status.textContent='Enter your purchase email and complete the verification.';};
script.onerror=()=>{status.textContent='Verification could not load. Try again later.';};document.head.append(script);
</script></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}' https://challenges.cloudflare.com; style-src 'nonce-${nonce}'; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      },
    },
  );
}
