'use strict';
// storage.js — DB persistence and server sync (copied from app.js)
// Functions: loadDB, _saveDBNow, saveDB, saveDBSync, exportDBJson, importDBJson, downloadServerBackup

// ── Server sync state ─────────────────────────────────────────
var _serverSynced=false;
var _saveDebounceTimer=null;

async function loadDB(){
  try{
    var r=await fetch('/api/data/db');
    if(r.status===401){showLoginOverlay();return;}
    var d=await r.json();
    if(d&&typeof d==='object'){
      Object.keys(DB).forEach(function(k){if(d[k]!==undefined)DB[k]=d[k];});
    }
    // migrate legacy single-contact fields to contacts[] array
    var _migrated=false;
    Object.keys(DB.edits||{}).forEach(function(k){
      var e=DB.edits[k];
      if(!e.contacts&&(e.contactName||e.contactTitle||(e.phones&&e.phones.length))){
        e.contacts=[{name:e.contactName||'',title:e.contactTitle||'',phones:(e.phones||[]).slice()}];
        delete e.contactName;delete e.contactTitle;delete e.phones;
        _migrated=true;
      }
    });
    if(_migrated){saveDB();console.log('[migration] legacy contacts migrated');}
    _serverSynced=true;
  }catch(e){
    console.warn('Server fetch failed, using empty DB:',e.message);
  }
}
function _saveDBNow(){
  fetch('/api/data/db',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(DB)}).catch(function(e){console.warn('saveDB sync failed:',e.message);});
}
function saveDB(){
  clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer=setTimeout(function(){_saveDBNow();},300);
}
function saveDBSync(){clearTimeout(_saveDebounceTimer);_saveDBNow();}

function exportDBJson(){
  var data=JSON.stringify({version:2,exportedAt:new Date().toISOString(),db:DB},null,2);
  var blob=new Blob([data],{type:'application/json'});
  var a=document.createElement('a');var _burl=URL.createObjectURL(blob);a.href=_burl;
  a.download='atena_crm_backup_'+todayStr().replace(/\//g,'-')+'.json';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(_burl);},60000);
  showToast('✅ پشتیبان دانلود شد');
}
function importDBJson(input){
  var file=input.files&&input.files[0];if(!file)return;
  var reader=new FileReader();
  reader.onload=function(e){
    try{
      var parsed=JSON.parse(e.target.result);
      var src=parsed.db||parsed;
      if(!src||typeof src!=='object'||!src.edits)throw new Error('فایل معتبر نیست');
      if(!confirm('⚠ این عملیات داده‌های فعلی را جایگزین می‌کند. ادامه می‌دهید؟'))return;
      Object.assign(DB,src);
      saveDBSync();
      showToast('✅ داده‌ها بازیابی شدند — صفحه رفرش می‌شود',2000);
      setTimeout(function(){location.reload();},2200);
    }catch(err){showToast('❌ خطا: '+err.message);}
  };
  reader.readAsText(file);
  input.value='';
}

// Server backup download
async function downloadServerBackup(){
  try{
    var r=await fetch('/api/data/backup');
    var d=await r.json();
    var blob=new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='atena_backup_'+(new Date().toISOString().slice(0,10))+'.json';
    a.click();
    showToast('✅ بکاپ سرور دانلود شد',2500);
  }catch(e){showToast('⚠ خطا در دریافت بکاپ: '+e.message);}
}

// ── Server-Sent Events (SSE) ─────────────────────────────────────
var _sse = null;
var _sseReconnectTimer = null;

function initSSE() {
  if (_sse) return;
  _sse = new EventSource('/api/events/stream');
  _sse.onmessage = function(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.type === 'db-updated') {
        _sseReloadDB(data.by);
      }
    } catch(err) {}
  };
  _sse.onerror = function() {
    _sse.close(); _sse = null;
    clearTimeout(_sseReconnectTimer);
    _sseReconnectTimer = setTimeout(initSSE, 8000);
  };
}

function _sseReloadDB(byUser) {
  fetch('/api/data/db').then(function(r){ return r.ok ? r.json() : null; }).then(function(d) {
    if (!d || typeof d !== 'object') return;
    var merged = Object.assign({}, DB, d);
    merged.weekEntries = Object.assign({}, DB.weekEntries, d.weekEntries || {});
    // Smart merge: local edits with newer _ts take priority over server version
    var mergedEdits = Object.assign({}, d.edits || {});
    var localEdits3 = DB.edits || {};
    Object.keys(localEdits3).forEach(function(k) {
      var le = localEdits3[k] || {}; var se = mergedEdits[k] || {};
      if ((le._ts || 0) >= (se._ts || 0)) mergedEdits[k] = le;
      else mergedEdits[k] = Object.assign({}, le, se);
    });
    merged.edits = mergedEdits;
    Object.keys(merged).forEach(function(k) { DB[k] = merged[k]; });
    if (currentTab === 'weekplan') renderWeekPlan();
    else if (currentTab === 'provinces') { renderDashboard(); renderTable(); }
    else if (currentTab === 'activity') renderActivity();
    else if (currentTab === 'kpi') renderKPIPanel();
    var name = byUser ? (USERS[byUser] || byUser) : 'کاربر دیگری';
    showToast('🔄 ' + name + ' تغییراتی اعمال کرد', 3000);
  }).catch(function() {});
}

