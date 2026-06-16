'use strict';
// banner.js — Followup banner and center filtering (copied from app.js)
// Functions: getFollowups, renderBanner, setBannerUser, setBannerTag, bannerSnooze,
//   getFiltered, _renderRecentCenters

// ════════════════════════ BANNER (followups) ═══════════
// بهینه: فقط edits که followupDate دارند
function getFollowups(){
  var today=todayStr();var items=[];
  _buildPCCache();
  var validK=_getAllValidRecKeys?_getAllValidRecKeys():new Set();
  Object.keys(DB.edits).forEach(function(k){
    var e=DB.edits[k];var fd=e.followupDate||'';if(!fd||fd>today)return;
    var st=e.status||'بدون تماس';if(st==='قرارداد بسته شد'||st==='غیرفعال')return;
    var pts=k.split('_');var tp=pts[0];var id=pts.slice(1).join('_');
    var name=id;var provName='';
    var isOrphan=validK.size>0&&!validK.has(k);
    if(!isOrphan){
      if(tp==='center'){
        var c=CENTERS.find(function(x){return x.id===id;});
        if(c)name=c.name;provName='تهران';
        var ex=(DB.extra||[]).find(function(x){return x.id===id;});
        if(ex)name=ex.name;
      }else if(tp==='pc'){
        var provId=id.split('||')[0];
        var cArr=_PC_CACHE[provId]||[];
        var found=cArr.find(function(x){return x.id===id;});
        if(found)name=found.name;
        var ex2=(DB.extra||[]).find(function(x){return x.id===id;});
        if(ex2)name=ex2.name;
        var pv=getAllProvinces().find(function(p){return p.id===provId;});
        if(pv)provName=pv.name;
      }
    }
    var _ow=e.owner||'';
    if(!_ow){
      if(tp==='center'){var _cco=CENTERS.find(function(x){return x.id===id;});if(_cco&&_cco.owner)_ow=_cco.owner;}
      else{var _pId3=id.split('||')[0];var _cArr3=_PC_CACHE[_pId3]||[];var _co3=_cArr3.find(function(x){return x.id===id;});if(_co3&&_co3.owner)_ow=_co3.owner;}
      if(!_ow){var _ex3=(DB.extra||[]).find(function(x){return x.id===id;});if(_ex3&&_ex3.owner)_ow=_ex3.owner;}
    }
    items.push({rtype:tp,id:id,name:name,date:fd,overdue:fd<today,
      owner:_ow,provName:provName,tags:rTags(tp,id),recKey:k,isOrphan:isOrphan});
  });
  return items;
}

function renderBanner(){
  var banner=document.getElementById('banner');if(!banner)return;
  if(_currentProvId){banner.style.display='none';return;}
  var allItems=getFollowups();
  // کارشناسان فقط پیگیری‌های خودشان را ببینند
  var effUser=_isExpert()?currentUser:_bannerFilterUser;
  var filtered=allItems.filter(function(it){
    if(effUser&&it.owner!==effUser)return false;
    if(_bannerFilterTag&&it.tags.indexOf(_bannerFilterTag)===-1)return false;
    return true;
  });
  // پنهان کردن فیلتر کارشناس برای کارشناس
  var buEl=document.getElementById('bannerUser');if(buEl)buEl.style.display=_isExpert()?'none':'';
  if(!filtered.length){banner.style.display='none';return;}
  banner.style.display='';
  // گروه‌بندی
  var overdueArr=filtered.filter(function(it){return it.overdue&&!it.isOrphan;});
  var todayArr=filtered.filter(function(it){return !it.overdue&&!it.isOrphan;});
  var orphanArr=filtered.filter(function(it){return it.isOrphan;});
  // آمار عنوان
  var titleEl=document.getElementById('tb_title');
  if(titleEl){
    var badges='';
    if(overdueArr.length)badges+=' <span style="background:#dc2626;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px">'+overdueArr.length+' معوق</span>';
    if(todayArr.length)badges+=' <span style="background:#f59e0b;color:#fff;border-radius:10px;padding:1px 7px;font-size:10px">'+todayArr.length+' امروز</span>';
    titleEl.innerHTML='📅 پیگیری‌های امروز و معوق'+badges;
  }
  var tb=document.getElementById('tb_items');if(!tb)return;

  // Days overdue for an item
  function _odDays(it){
    if(!it.overdue||!it.date)return 0;
    var tp=todayStr().split('/').map(Number),dp=it.date.split('/').map(Number);
    return Math.max(0,Math.round((jMs(tp[0],tp[1],tp[2])-jMs(dp[0],dp[1],dp[2]))/86400000));
  }

  // Single row inside expert cards
  function _mkRow(it){
    var days=_odDays(it);
    var dc=days>30?'#dc2626':days>7?'#d97706':'#2563eb';
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg-raised);border-radius:6px;margin-bottom:3px;cursor:pointer;border:1px solid var(--border);transition:all .1s" onclick="openCenterModal(\''+it.rtype+'\',\''+it.id+'\')" onmouseenter="this.style.background=\'var(--bg-hover)\'" onmouseleave="this.style.background=\'var(--bg-raised)\'">'
      +'<span style="font-size:11px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-primary)">'+esc(it.name)+'</span>'
      +(it.overdue
        ?'<span style="font-size:10px;font-weight:700;color:'+dc+';white-space:nowrap;background:'+dc+'18;border-radius:4px;padding:1px 5px">'+days+' روز</span>'
        :'<span style="font-size:10px;color:#16a34a;font-weight:600;white-space:nowrap">امروز</span>')
      +'<span onclick="event.stopPropagation();bannerSnooze(\''+it.rtype+'\',\''+it.id+'\',event)" title="تعویق ۳ روز" style="cursor:pointer;font-size:10px;padding:2px 5px;background:#fef3c7;border-radius:4px;color:#92400e;flex-shrink:0">⏰</span>'
      +'</div>';
  }

  var html='';

  if(!_isExpert()){
    // ── MANAGER: grouped by expert ──
    // compute overdue task counts per expert
    var _today2=todayStr();
    var _tasksByExp={};
    (DB.tasks||[]).forEach(function(t){
      if(t.owner&&t.status!=='done'&&t.dueDate&&t.dueDate<=_today2){
        _tasksByExp[t.owner]=(_tasksByExp[t.owner]||0)+1;
      }
    });
    var byExpert={};
    filtered.forEach(function(it){
      if(it.isOrphan)return;
      var uid=it.owner||'__none__';
      if(!byExpert[uid])byExpert[uid]=[];
      byExpert[uid].push(it);
    });
    var expertKeys=Object.keys(byExpert).sort(function(a,b){
      return byExpert[b].filter(function(i){return i.overdue;}).length
            -byExpert[a].filter(function(i){return i.overdue;}).length;
    });
    html+='<div class="mgr-banner-grid">';
    expertKeys.forEach(function(uid){
      var items=byExpert[uid];
      var ov=items.filter(function(i){return i.overdue;});
      var td=items.filter(function(i){return !i.overdue;});
      var uname=uid==='__none__'?'بدون مسئول':(USERS[uid]||uid);
      var clr=typeof umGetColor==='function'?umGetColor(uid):'#6366f1';
      var sorted=items.slice().sort(function(a,b){return _odDays(b)-_odDays(a);});
      var top=sorted.slice(0,3),rest=sorted.length-3;
      html+='<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden">'
        +'<div style="background:'+clr+'22;border-bottom:1px solid var(--border);padding:8px 12px;display:flex;align-items:center;justify-content:space-between">'
        +'<span style="font-weight:700;font-size:12px">'+esc(uname)+'</span>'
        +'<div style="display:flex;gap:5px;align-items:center">'
        +(ov.length?'<span style="background:#dc2626;color:#fff;border-radius:9px;padding:1px 7px;font-size:10px;font-weight:700">'+ov.length+' معوق</span>':'')
        +(td.length?'<span style="background:#f59e0b;color:#fff;border-radius:9px;padding:1px 7px;font-size:10px;font-weight:700">'+td.length+' امروز</span>':'')
        +(_tasksByExp[uid]?'<span style="background:#7c3aed;color:#fff;border-radius:9px;padding:1px 7px;font-size:10px;font-weight:700" title="وظایف سررسید">📌 '+_tasksByExp[uid]+'</span>':'')
        +(uid!=='__none__'?'<button onclick="openOverdueList(\''+uid+'\')" style="font-size:9px;padding:2px 6px;background:var(--bg-raised);border:1px solid var(--border);border-radius:4px;cursor:pointer;font-family:inherit;color:var(--text-secondary)">همه</button>':'')
        +'</div></div>'
        +'<div style="padding:8px 10px">'
        +top.map(_mkRow).join('')
        +(rest>0?'<div style="font-size:10px;text-align:center;color:var(--brand);padding:5px 0;cursor:pointer;font-weight:600" onclick="openOverdueList(\''+uid+'\')">+ '+rest+' مرکز دیگر</div>':'')
        +'</div></div>';
    });
    if(orphanArr.length){
      html+='<div style="background:#fef3c7;border:1px dashed #d97706;border-radius:8px;padding:8px 10px;align-self:start">'
        +'<div style="font-size:11px;font-weight:700;color:#92400e;margin-bottom:4px">⚠ پیگیری مراکز حذف‌شده</div>'
        +'<div style="font-size:10px;color:#78350f;margin-bottom:6px">این مراکز از سیستم حذف شده‌اند اما تاریخ پیگیری دارند. با ✕ پیگیری را پاک کنید.</div>'
        +orphanArr.map(function(o){return'<span style="font-size:10px;text-decoration:line-through;color:#92400e" title="مرکز حذف‌شده — پیگیری باقی مانده">'+esc(o.id)+'</span>'
          +'<span onclick="clearOrphanFollowup(\''+o.recKey+'\')" title="حذف این پیگیری" style="cursor:pointer;color:#dc2626;font-size:11px;margin-right:6px"> ✕</span> ';}).join('')
        +'</div>';
    }
    html+='</div>';
  } else {
    // ── EXPERT: time-bucket view ──
    var urgent  =overdueArr.filter(function(i){return _odDays(i)>30;});
    var moderate=overdueArr.filter(function(i){var d=_odDays(i);return d>=7&&d<=30;});
    var recent  =overdueArr.filter(function(i){return _odDays(i)<7;});
    var buckets=[
      {label:'🔴 فوری (بیش از ۳۰ روز)',items:urgent,col:'#dc2626'},
      {label:'🟡 معوق (۷ تا ۳۰ روز)',items:moderate,col:'#d97706'},
      {label:'🔵 اخیر (کمتر از ۷ روز)',items:recent,col:'#2563eb'},
      {label:'📅 پیگیری امروز',items:todayArr,col:'#16a34a'}
    ];
    html+='<div style="display:flex;flex-direction:column;gap:10px">';
    buckets.forEach(function(b){
      if(!b.items.length)return;
      html+='<div>'
        +'<div style="font-size:10px;font-weight:700;color:'+b.col+';margin-bottom:5px">'+b.label+'</div>'
        +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px">'
        +b.items.map(_mkRow).join('')
        +'</div></div>';
    });
    // show tasks due today/overdue in banner for expert
    var _myTasks=(DB.tasks||[]).filter(function(t){
      return t.owner===currentUser&&t.status!=='done'&&t.dueDate&&t.dueDate<=todayStr();
    });
    if(_myTasks.length){
      var _overTasks=_myTasks.filter(function(t){return t.dueDate<todayStr();});
      var _todTasks=_myTasks.filter(function(t){return t.dueDate===todayStr();});
      html+='<div><div style="font-size:10px;font-weight:700;color:#7c3aed;margin-bottom:5px">📌 وظایف سررسید'+((_overTasks.length?(' ('+_overTasks.length+' معوق)'):'')+(_todTasks.length?(' + '+_todTasks.length+' امروز'):''))+'</div>'
        +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px">';
      _myTasks.slice(0,6).forEach(function(t){
        var isOv=t.dueDate<todayStr();
        html+='<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg-raised);border-radius:7px;cursor:pointer" onclick="_taskSearch=\'\';_taskFilter=\'mine\';switchTab(\'tasks\')">';
        html+='<span style="font-size:11px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6d28d9">'+esc(t.title||'—')+'</span>';
        html+=(isOv?'<span style="font-size:10px;font-weight:700;color:#dc2626">'+t.dueDate+'</span>':'<span style="font-size:10px;color:#16a34a;font-weight:600">امروز</span>');
        html+='</div>';
      });
      if(_myTasks.length>6)html+='<div style="font-size:10px;text-align:center;color:var(--brand);padding:5px;cursor:pointer;font-weight:600" onclick="switchTab(\'tasks\')">+ '+(_myTasks.length-6)+' وظیفه دیگر</div>';
      html+='</div></div>';
    }
    html+='</div>';
  }
  tb.innerHTML=html;
}
function setBannerUser(v){_bannerFilterUser=v;renderBanner();}
function setBannerTag(v){_bannerFilterTag=v?parseInt(v):0;renderBanner();}
function bannerSnooze(rtype,id,ev){
  if(ev)ev.stopPropagation();
  var e=getE(rtype,id);
  var fd=e.followupDate||todayStr();
  var parts=fd.split('/').map(Number);
  var gDate=j2g(parts[0],parts[1],parts[2]);
  var d=new Date(gDate[0],gDate[1]-1,gDate[2]+3);
  var nj=g2j(d.getFullYear(),d.getMonth()+1,d.getDate());
  var newDate=nj[0]+'/'+String(nj[1]).padStart(2,'0')+'/'+String(nj[2]).padStart(2,'0');
  setE(rtype,id,'followupDate',newDate);
  renderBanner();renderDashboard();
  showToast('⏰ تعویق تا '+newDate,2000);
}

// ════════════════════════ TABLE RENDER ════════════════
function getFiltered(){
  var q=(document.getElementById('srch')||{}).value||'';
  var fp=(document.getElementById('fPot')||{}).value||'';
  var fs=(document.getElementById('fStatus')||{}).value||'';
  var fl=(document.getElementById('fLead')||{}).value||'';
  var fo=(document.getElementById('fOwner')||{}).value||'';
  var _ftEl=document.getElementById('fTag');var ft=_ftEl&&_ftEl.value?parseInt(_ftEl.value):0;
  var ftp=document.getElementById('fType')?document.getElementById('fType').value:'';
  var effectiveOwner=fo||_globalOwnerFilter||(_isExpert()?currentUser:'');
  var provId=_currentProvId;
  var rtype=getProvType(provId);
  var rows=getProvCenters(provId);
  return rows.filter(function(r){
    var e=getE(rtype,r.id);
    if(q&&!fMatch(q,r.name))return false;
    if(fp&&String(e.potential||r.potential)!==fp)return false;
    var st=e.status||'بدون تماس';if(fs&&st!==fs)return false;
    var lead=(e.lead||r.lead||'').replace(/[ي]/g,'ی').replace(/[ك]/g,'ک').trim();if(fl&&lead!==fl)return false;
    var owner=e.owner||r.owner||'';if(effectiveOwner&&owner!==effectiveOwner)return false;
    if(ftp){var ctype=e.type||r.type||'';if(ctype.indexOf(ftp)<0)return false;}
    if(ft){var tgs=rTags(rtype,r.id);if(tgs.indexOf(ft)===-1)return false;}
    // Quick filter
    if(_quickFilter==='overdue')return isOverdue(rtype,r.id);
    if(_quickFilter==='nofollowup'){return !e.followupDate;}
    if(_quickFilter==='noowner'){return !(e.owner||r.owner);}
    if(_quickFilter==='stalled')return isStalled(rtype,r.id);
    if(_quickFilter==='pot1'){return (e.potential||r.potential)==1;}
    return true;
  });
}


function _renderRecentCenters(container){
  if(!_recentCenters||!_recentCenters.length)return;
  var html='<div class="recent-centers-bar" style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:7px 10px;margin-bottom:8px;display:flex;align-items:center;gap:8px;overflow-x:auto;flex-wrap:nowrap">'
    +'<span style="font-size:10px;color:var(--text-muted);white-space:nowrap;font-weight:600">🕐 اخیر:</span>';
  _recentCenters.forEach(function(rc){
    var label=rc.name||rc.id;
    if(label.length>14)label=label.slice(0,14)+'…';
    html+='<button onclick="openCenterModal(\''+rc.rtype+'\',\''+rc.id+'\')" style="white-space:nowrap;font-size:10px;background:var(--bg-raised);border:1px solid var(--border);border-radius:5px;padding:3px 8px;cursor:pointer;color:var(--text-primary);font-family:inherit">'+esc(label)+'</button>';
  });
  html+='</div>';
  if(container){var old=container.querySelector('.recent-centers-bar');if(old)old.remove();container.insertAdjacentHTML('afterbegin',html);}
}

