'use strict';
// auth-ui.js — Login/Auth UI helpers (copied from app.js)
// Functions: showLoginOverlay, hideLoginOverlay, doLogin, doLogout

// ── Login/Auth helpers ────────────────────────────────────────
function showLoginOverlay(){
  var o=document.getElementById('loginOverlay');
  if(o){o.style.display='flex';var u=document.getElementById('loginUser');if(u)u.focus();}
}
function hideLoginOverlay(){
  var o=document.getElementById('loginOverlay');
  if(o)o.style.display='none';
}
async function doLogin(){
  var u=(document.getElementById('loginUser')||{}).value||'';
  var p=(document.getElementById('loginPass')||{}).value||'';
  var errEl=document.getElementById('loginErr');
  if(errEl)errEl.style.display='none';
  try{
    var r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    var d=await r.json();
    if(!r.ok){if(errEl){errEl.textContent=d.error||'خطا';errEl.style.display='block';}return;}
    currentUser=d.user.username;
    hideLoginOverlay();
    init();
  }catch(e){
    if(errEl){errEl.textContent='خطا در اتصال به سرور';errEl.style.display='block';}
  }
}
async function doLogout(){
  saveDBSync();
  await fetch('/api/auth/logout',{method:'POST'}).catch(function(){});
  location.reload();
}
