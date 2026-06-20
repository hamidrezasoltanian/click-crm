'use strict';
// ─── Trade KPI Module ─────────────────────────────────────────────────────
// Renders when switchTab('trade-kpi') is called
// Exposes: window.renderTradeKPIPanel()

var _tkView = 'tasks';       // tasks | kpi | projects
var _tkTasks = [];
var _tkColumns = null;       // [{id,label,color}] — loaded from settings
var _tkKPIData = null;
var _tkDeductions = [];
var _tkHistory = [];
var _tkMilestones = [];
var _tkMonth = '';           // 'YYYY/MM'
var _tkEmployee = '';        // target employee (manager selects; own for non-manager)
var _tkSettings = {};
var _tkSalaryData = null;

var _TK_DEFAULT_COLS = [
  {id:'open',        label:'باز',           color:'#6366f1'},
  {id:'in_progress', label:'در حال انجام', color:'#f59e0b'},
  {id:'waiting',     label:'منتظر',         color:'#8b5cf6'},
  {id:'done',        label:'تکمیل',         color:'#22c55e'}
];

var _TK_INDICATORS = [
  {id:'customs',      label:'دقت گمرکی (EPL/NTSW)',          deductPer:'هر خطای ثبت',   defPts:20},
  {id:'sla',          label:'رعایت زمان‌بندی (SLA)',          deductPer:'هر روز تأخیر',  defPts:10},
  {id:'traceability', label:'مستندسازی (Traceability)',       deductPer:'هر سند مفقود',  defPts:15},
  {id:'reporting',    label:'گزارش‌دهی پیش‌دستانه',         deductPer:'هر پیگیری مدیر', defPts:10},
  {id:'teamwork',     label:'انطباق رفتاری (Team Synergy)',   deductPer:'نمره کیفی',     defPts:0}
];

var _TK_PROJECTS = {
  A:{label:'A — حذف ضمانت بانکی', icon:'💰', metric:'ریال/دلار آزاد شده', unit:'rial',
     desc:'حذف ضمانت نقدی بانکی — آزادسازی سرمایه مسدود'},
  B:{label:'B — تسریع ترخیص',     icon:'⚡', metric:'روزهای صرفه‌جویی',   unit:'days',
     desc:'کاهش Lead Time ترخیص نسبت به میانگین تاریخی'},
  C:{label:'C — اتوماسیون فرایند', icon:'🤖', metric:'درصد کاهش زمان',    unit:'count',
     desc:'اسکریپت/ابزاری که ≥۲۰٪ زمان فرایند دستی را کاهش دهد'},
  D:{label:'D — مهندسی لجستیک',   icon:'🚢', metric:'ریال صرفه‌جویی',    unit:'rial',
     desc:'کاهش قیمت تمام‌شده کالا یا هزینه حمل نسبت به سورس‌های قبلی'},
  E:{label:'E — نمایندگی/IRC',     icon:'📋', metric:'تعداد IRC ثبت شده', unit:'count',
     desc:'اخذ نمایندگی / ثبت IRC جدید در اداره کل تجهیزات پزشکی'}
};

// ── Helpers ───────────────────────────────────────────────────────────────
function _tkFmt(n) { return n!=null ? Number(n).toLocaleString('fa') : '—'; }

function _tkSLAInfo(deadline, completedAt) {
  if (!deadline) return {text:'بدون ددلاین', cls:'', days:null};
  var today = typeof todayStr==='function' ? todayStr() : new Date().toISOString().slice(0,10).replace(/-/g,'/');
  var ref = completedAt || today;
  var dp = deadline.split('/').map(Number), rp = ref.split('/').map(Number);
  // simple Jalali string comparison works for ordering
  if (deadline > ref) {
    // future
    var ms = (typeof jMs==='function') ? jMs(dp[0],dp[1],dp[2]) - jMs(rp[0],rp[1],rp[2]) : 0;
    var days = Math.ceil(ms/(1000*60*60*24));
    return {text: days + ' روز مانده', cls:'sla-ok', days: days};
  } else if (deadline === ref) {
    return {text:'امروز ددلاین', cls:'sla-warn', days:0};
  } else {
    var ms2 = (typeof jMs==='function') ? jMs(rp[0],rp[1],rp[2]) - jMs(dp[0],dp[1],dp[2]) : 0;
    var delay = Math.ceil(ms2/(1000*60*60*24));
    return {text: delay + ' روز تأخیر', cls:'sla-over', days:-delay};
  }
}

function _tkJalaliMonth() {
  if (typeof todayStr === 'function') {
    var t = todayStr(); // YYYY/MM/DD
    return t.slice(0,7); // YYYY/MM
  }
  return '';
}

function _tkIsManager() {
  var role = window._currentUserRole || (typeof currentUser !== 'undefined' && window.USERS ? '' : '');
  // check via session stored role
  return typeof _isManager === 'function' ? _isManager() : false;
}

function _tkIsSuperAdmin() {
  var role = window._currentUserRole || '';
  return role === 'سوپر ادمین';
}

function _tkGetColumns() {
  return (_tkSettings.columns && _tkSettings.columns.length) ? _tkSettings.columns : _TK_DEFAULT_COLS;
}

// ── API calls ─────────────────────────────────────────────────────────────
function _tkAPI(method, path, body) {
  var opts = {method:method, headers:{'Content-Type':'application/json'}};
  if (body) opts.body = JSON.stringify(body);
  return fetch('/api/trade-kpi' + path, opts).then(function(r){
    if (!r.ok) return r.json().then(function(e){throw new Error(e.error||r.status);});
    return r.json();
  });
}

function _tkLoadAll() {
  var tasks = _tkAPI('GET','/tasks');
  var settings = _tkAPI('GET','/settings');
  var milestones = _tkAPI('GET','/milestones');
  var history = _tkEmployee ? _tkAPI('GET','/kpi-history/'+encodeURIComponent(_tkEmployee)) : Promise.resolve([]);
  var kpi = (_tkEmployee && _tkMonth) ? _tkAPI('GET','/kpi/'+encodeURIComponent(_tkEmployee)+'/'+encodeURIComponent(_tkMonth)) : Promise.resolve(null);
  return Promise.all([tasks, settings, milestones, history, kpi]).then(function(res){
    _tkTasks = res[0] || [];
    _tkSettings = res[1] || {};
    _tkMilestones = res[2] || [];
    _tkHistory = res[3] || [];
    _tkKPIData = res[4];
    if (_tkKPIData) _tkDeductions = _tkKPIData.deductions || [];
  });
}

// ── Main render ───────────────────────────────────────────────────────────
window.renderTradeKPIPanel = function() {
  var root = document.getElementById('tradeKPIRoot');
  if (!root) return;

  // determine current employee
  if (!_tkEmployee) {
    _tkEmployee = (typeof currentUser !== 'undefined') ? currentUser : '';
  }
  if (!_tkMonth) {
    _tkMonth = _tkJalaliMonth();
  }

  root.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">در حال بارگذاری…</div>';
  _addTKStyles();

  _tkLoadAll().then(function(){
    _tkRenderShell(root);
    _tkRenderView();
  }).catch(function(e){
    root.innerHTML = '<div style="padding:20px;color:#ef4444">⚠ خطا در بارگذاری: ' + esc(e.message) + '</div>';
  });
};

function _tkRenderShell(root) {
  var isManager = _tkIsManager();
  root.innerHTML =
    '<div class="tk-header">' +
      '<div class="tk-tabs">' +
        '<button class="tk-tab'+((_tkView==='tasks')?' active':'')+'" onclick="_tkSetView(\'tasks\')">📋 وظایف</button>' +
        '<button class="tk-tab'+((_tkView==='kpi')?' active':'')+'" onclick="_tkSetView(\'kpi\')">📊 KPI ماهانه</button>' +
        '<button class="tk-tab'+((_tkView==='projects')?' active':'')+'" onclick="_tkSetView(\'projects\')">🚀 پروژه‌ها</button>' +
      '</div>' +
      (isManager ? '<div class="tk-header-actions"><button class="tk-btn tk-btn-outline" onclick="_tkOpenColsModal()" title="مدیریت ستون‌ها">⚙️ ستون‌ها</button></div>' : '') +
    '</div>' +
    '<div id="tkViewArea"></div>';
}

window._tkSetView = function(v) {
  _tkView = v;
  document.querySelectorAll('.tk-tab').forEach(function(b){
    b.classList.toggle('active', b.textContent.includes(v==='tasks'?'وظایف':v==='kpi'?'KPI':'پروژه'));
  });
  _tkRenderView();
};

function _tkRenderView() {
  if (_tkView === 'tasks') _tkRenderTasks();
  else if (_tkView === 'kpi') _tkRenderKPI();
  else _tkRenderProjects();
}

// ── Tasks View ────────────────────────────────────────────────────────────
function _tkRenderTasks() {
  var area = document.getElementById('tkViewArea');
  if (!area) return;
  var cols = _tkGetColumns();

  var html = '<div class="tk-task-header">' +
    '<button class="tk-btn tk-btn-primary" onclick="_tkOpenTaskModal(null)">+ تسک جدید</button>' +
  '</div>' +
  '<div class="tk-kanban">';

  cols.forEach(function(col) {
    var tasks = _tkTasks.filter(function(t){ return t.status === col.id; });
    html += '<div class="tk-col" data-col="'+esc(col.id)+'">' +
      '<div class="tk-col-head" style="border-top:3px solid '+col.color+'">'+
        '<span class="tk-col-title">'+esc(col.label)+'</span>' +
        '<span class="tk-col-count" style="background:'+col.color+'20;color:'+col.color+'">'+tasks.length+'</span>' +
      '</div>' +
      '<div class="tk-col-body">';

    tasks.forEach(function(t) {
      html += _tkRenderCard(t, col.color);
    });

    html += '<button class="tk-add-card" onclick="_tkOpenTaskModal(null,\''+esc(col.id)+'\')">+ افزودن</button>';
    html += '</div></div>';
  });

  html += '</div>';
  area.innerHTML = html;
}

function _tkRenderCard(t, colColor) {
  var sla = _tkSLAInfo(t.deadline, t.completed_at);
  var stages = Array.isArray(t.stages) ? t.stages : (typeof t.stages === 'string' ? JSON.parse(t.stages||'[]') : []);
  var totalStages = stages.length;
  var doneStages = stages.filter(function(s){return s.done;}).length;
  var pct = totalStages ? Math.round(doneStages/totalStages*100) : 0;

  var priorityColors = ['','#94a3b8','#f59e0b','#ef4444'];
  var priorityLabels = ['','پایین','متوسط','بالا'];
  var pr = t.priority||2;

  return '<div class="tk-card" onclick="_tkOpenTaskModal(\''+t.id+'\')">' +
    '<div class="tk-card-title">'+esc(t.title)+'</div>' +
    (t.center_name ? '<div class="tk-card-center" onclick="event.stopPropagation();if(t)openCenterModal(t.center_key.split(\'_\')[0],t.center_key.split(\'_\').slice(1).join(\'_\'))">🏥 '+esc(t.center_name)+'</div>' : '') +
    '<div class="tk-card-meta">' +
      '<span class="tk-pill" style="background:'+priorityColors[pr]+'20;color:'+priorityColors[pr]+'">'+priorityLabels[pr]+'</span>' +
      (t.deadline ? '<span class="tk-sla '+sla.cls+'">⏱ '+sla.text+'</span>' : '') +
    '</div>' +
    (totalStages ? '<div class="tk-progress-wrap"><div class="tk-progress-bar" style="width:'+pct+'%;background:'+(pct===100?'#22c55e':'#6366f1')+'"></div></div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">'+doneStages+'/'+totalStages+' مرحله</div>' : '') +
    '<div class="tk-card-actions" onclick="event.stopPropagation()">' +
      (_tkIsManager() ? '<button class="tk-icon-btn" onclick="_tkManagerFollowup(\''+t.id+'\')" title="مدیر پیگیری کرد — ۱۰ امتیاز کسر">👁 پیگیری</button>' : '') +
    '</div>' +
  '</div>';
}

// ── Task Modal ────────────────────────────────────────────────────────────
window._tkOpenTaskModal = function(taskId, prefillStatus) {
  var task = taskId ? _tkTasks.find(function(t){return t.id===taskId;}) : null;
  var cols = _tkGetColumns();
  var stages = task ? (Array.isArray(task.stages)?task.stages:(typeof task.stages==='string'?JSON.parse(task.stages||'[]'):[])) : [];
  var isManager = _tkIsManager();

  var colOpts = cols.map(function(c){
    return '<option value="'+esc(c.id)+'"'+(((task?task.status:prefillStatus||cols[0].id)===c.id)?' selected':'')+'>'+esc(c.label)+'</option>';
  }).join('');

  var body =
    '<div class="m-2col">' +
      '<div style="grid-column:1/-1"><label>عنوان *</label><input id="tkT_title" class="m-inp" value="'+esc(task?task.title||'':'')+'"></div>' +
      '<div><label>دسته‌بندی</label><select id="tkT_cat" class="m-inp">'+
        ['other','customs','logistics','procurement','documentation'].map(function(c){
          var labels = {other:'سایر',customs:'گمرک',logistics:'لجستیک',procurement:'خرید',documentation:'مستندات'};
          return '<option value="'+c+'"'+((task&&task.category===c)?' selected':'')+'>'+labels[c]+'</option>';
        }).join('')+'</select></div>' +
      '<div><label>اولویت</label><select id="tkT_pri" class="m-inp">'+
        '<option value="1"'+((task&&task.priority===1)?' selected':'')+'>پایین</option>'+
        '<option value="2"'+((!task||task.priority===2)?' selected':'')+'>متوسط</option>'+
        '<option value="3"'+((task&&task.priority===3)?' selected':'')+'>بالا</option>'+
      '</select></div>' +
      '<div><label>ستون</label><select id="tkT_status" class="m-inp">'+colOpts+'</select></div>' +
      '<div><label>ددلاین (شمسی)</label><input id="tkT_deadline" class="m-inp" value="'+esc(task?task.deadline||'':'')+ '" readonly onclick="openJDP(this,function(v){document.getElementById(\'tkT_deadline\').value=v})" placeholder="کلیک برای انتخاب" style="cursor:pointer"></div>' +
      (task && task.completed_at ? '<div><label>تاریخ تکمیل</label><input id="tkT_done" class="m-inp" value="'+esc(task.completed_at||'')+'" readonly onclick="openJDP(this,function(v){document.getElementById(\'tkT_done\').value=v})" style="cursor:pointer"></div>' : '') +
      '<div style="grid-column:1/-1"><label>مرکز مشتری</label><div style="display:flex;gap:6px"><input id="tkT_cname" class="m-inp" value="'+esc(task?task.center_name||'':'')+'" placeholder="نام مرکز..." style="flex:1"><input id="tkT_ckey" type="hidden" value="'+esc(task?task.center_key||'':'')+'"><button type="button" class="tk-btn tk-btn-outline" onclick="_tkPickCenter()" style="white-space:nowrap">🔍 انتخاب</button></div></div>' +
      '<div style="grid-column:1/-1"><label>یادداشت</label><textarea id="tkT_notes" class="m-inp" rows="2">'+esc(task?task.notes||'':'')+'</textarea></div>' +
    '</div>' +
    '<hr style="margin:12px 0;border:none;border-top:1px solid var(--border-input)">' +
    '<div style="font-weight:700;color:var(--text-primary);margin-bottom:8px">مراحل و عملیات</div>' +
    '<div id="tkStagesArea">'+_tkRenderStages(stages)+'</div>' +
    '<button type="button" class="tk-btn tk-btn-outline" style="margin-top:8px" onclick="_tkAddStage()">+ مرحله جدید</button>';

  var foot =
    (task && isManager ? '<button class="btn-danger" onclick="_tkDeleteTask(\''+taskId+'\')">🗑 حذف</button>' : '') +
    (task && task.deadline && !task.completed_at ? '<button class="tk-btn tk-btn-primary" style="background:#22c55e;border-color:#22c55e" onclick="_tkCompleteTask(\''+taskId+'\')">✓ تکمیل شد</button>' : '') +
    '<button class="btn-secondary" onclick="closeModal(\'tkTaskModal\')">انصراف</button>' +
    '<button class="btn-primary" onclick="_tkSaveTask(\''+taskId+'\')">💾 ذخیره</button>';

  openModal('tkTaskModal', task ? '✏️ ویرایش تسک' : '+ تسک جدید', body, foot, {lg:true});
};

function _tkRenderStages(stages) {
  if (!stages.length) return '<div style="color:var(--text-muted);font-size:12px;padding:8px">هنوز مرحله‌ای اضافه نشده</div>';
  return stages.map(function(s, si) {
    var ops = s.ops || [];
    return '<div class="tk-stage" id="tkStage_'+si+'">' +
      '<div class="tk-stage-head">' +
        '<input type="checkbox" '+(s.done?'checked':'')+' onchange="_tkToggleStage('+si+',this.checked)" style="cursor:pointer">' +
        '<input class="tk-stage-inp" value="'+esc(s.title||'')+'" onchange="_tkEditStage('+si+',this.value)" placeholder="نام مرحله...">' +
        '<button type="button" class="tk-icon-btn" onclick="_tkRemoveStage('+si+')" title="حذف مرحله">✕</button>' +
      '</div>' +
      '<div class="tk-ops">' +
        ops.map(function(op, oi){
          return '<div class="tk-op">' +
            '<input type="checkbox" '+(op.done?'checked':'')+' onchange="_tkToggleOp('+si+','+oi+',this.checked)" style="cursor:pointer">' +
            '<input class="tk-op-inp" value="'+esc(op.title||'')+'" onchange="_tkEditOp('+si+','+oi+',this.value)" placeholder="عملیات...">' +
            '<button type="button" class="tk-icon-btn" onclick="_tkRemoveOp('+si+','+oi+')" title="حذف">✕</button>' +
          '</div>';
        }).join('') +
        '<button type="button" class="tk-add-op" onclick="_tkAddOp('+si+')">+ عملیات</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Stage/op manipulation (works on a transient _tkEditStages array)
var _tkEditStages = [];

window._tkAddStage = function() {
  _tkSyncStages();
  _tkEditStages.push({id:'s_'+Date.now(), title:'', done:false, ops:[]});
  document.getElementById('tkStagesArea').innerHTML = _tkRenderStages(_tkEditStages);
};
window._tkRemoveStage = function(si) {
  _tkSyncStages(); _tkEditStages.splice(si,1);
  document.getElementById('tkStagesArea').innerHTML = _tkRenderStages(_tkEditStages);
};
window._tkAddOp = function(si) {
  _tkSyncStages(); _tkEditStages[si].ops.push({id:'op_'+Date.now(), title:'', done:false});
  document.getElementById('tkStagesArea').innerHTML = _tkRenderStages(_tkEditStages);
};
window._tkRemoveOp = function(si, oi) {
  _tkSyncStages(); _tkEditStages[si].ops.splice(oi,1);
  document.getElementById('tkStagesArea').innerHTML = _tkRenderStages(_tkEditStages);
};
window._tkToggleStage = function(si, v) { _tkSyncStages(); _tkEditStages[si].done = v; };
window._tkToggleOp    = function(si, oi, v) { _tkSyncStages(); _tkEditStages[si].ops[oi].done = v; };
window._tkEditStage   = function(si, v) { _tkSyncStages(); _tkEditStages[si].title = v; };
window._tkEditOp      = function(si, oi, v) { _tkSyncStages(); _tkEditStages[si].ops[oi].title = v; };

function _tkSyncStages() {
  var area = document.getElementById('tkStagesArea');
  if (!area) return;
  if (!_tkEditStages.length) {
    // first sync — read from DOM inputs
    _tkEditStages = [];
  }
  area.querySelectorAll('.tk-stage').forEach(function(stEl, si) {
    if (!_tkEditStages[si]) _tkEditStages[si] = {id:'s_'+si, title:'', done:false, ops:[]};
    var titleInp = stEl.querySelector('.tk-stage-inp');
    if (titleInp) _tkEditStages[si].title = titleInp.value;
    var cb = stEl.querySelector('input[type=checkbox]');
    if (cb) _tkEditStages[si].done = cb.checked;
    stEl.querySelectorAll('.tk-op').forEach(function(opEl, oi) {
      if (!_tkEditStages[si].ops[oi]) _tkEditStages[si].ops[oi] = {id:'op_'+oi, title:'', done:false};
      var opInp = opEl.querySelector('.tk-op-inp');
      if (opInp) _tkEditStages[si].ops[oi].title = opInp.value;
      var opCb = opEl.querySelector('input[type=checkbox]');
      if (opCb) _tkEditStages[si].ops[oi].done = opCb.checked;
    });
  });
}

window._tkSaveTask = function(taskId) {
  _tkSyncStages();
  var title = (document.getElementById('tkT_title')||{}).value||'';
  if (!title.trim()) { showToast('⚠ عنوان الزامی است'); return; }
  var payload = {
    title: title.trim(),
    category: (document.getElementById('tkT_cat')||{}).value||'other',
    priority: parseInt((document.getElementById('tkT_pri')||{}).value||2),
    status: (document.getElementById('tkT_status')||{}).value||'open',
    deadline: (document.getElementById('tkT_deadline')||{}).value||null,
    completed_at: (document.getElementById('tkT_done')||{}).value||null,
    center_key: (document.getElementById('tkT_ckey')||{}).value||null,
    center_name: (document.getElementById('tkT_cname')||{}).value||null,
    notes: (document.getElementById('tkT_notes')||{}).value||null,
    stages: _tkEditStages
  };
  _tkEditStages = [];
  var method = taskId ? 'PUT' : 'POST';
  var path = taskId ? '/tasks/'+taskId : '/tasks';
  _tkAPI(method, path, payload).then(function(){
    closeModal('tkTaskModal');
    showToast('✅ ذخیره شد', 2000);
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

window._tkDeleteTask = function(taskId) {
  if (!confirm('این تسک حذف شود؟')) return;
  _tkAPI('DELETE', '/tasks/'+taskId).then(function(){
    closeModal('tkTaskModal');
    showToast('حذف شد');
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

window._tkCompleteTask = function(taskId) {
  var today = typeof todayStr === 'function' ? todayStr() : '';
  var task = _tkTasks.find(function(t){return t.id===taskId;});
  if (!task) return;
  var sla = _tkSLAInfo(task.deadline, today);
  _tkSyncStages();
  var payload = {status:'done', completed_at: today, stages: _tkEditStages};
  _tkAPI('PUT', '/tasks/'+taskId, payload).then(function(){
    closeModal('tkTaskModal');
    if (sla.days !== null && sla.days < 0) {
      // offer auto-deduction for SLA
      var delay = Math.abs(sla.days);
      var pts = delay * 10;
      if (confirm('این تسک ' + delay + ' روز تأخیر داشت.\nآیا ' + pts + ' امتیاز از شاخص SLA کسر شود؟')) {
        _tkAPI('POST', '/deductions', {
          employee: _tkEmployee,
          month: _tkMonth,
          indicator: 'sla',
          points: pts,
          reason: 'تأخیر ' + delay + ' روزه در تسک: ' + task.title,
          ref_task_id: taskId
        }).then(function(){ showToast('✅ تسک تکمیل + کسر SLA ثبت شد'); })
          .catch(function(){});
      }
    } else {
      showToast('✅ تکمیل شد');
    }
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

window._tkManagerFollowup = function(taskId) {
  if (!_tkIsManager()) return;
  var task = _tkTasks.find(function(t){return t.id===taskId;});
  if (!confirm('ثبت «مدیر پیگیری کرد» برای تسک «' + (task?task.title:'') + '»\n→ کسر ۱۰ امتیاز از شاخص گزارش‌دهی')) return;
  _tkAPI('POST', '/deductions', {
    employee: _tkEmployee, month: _tkMonth,
    indicator: 'reporting', points: 10,
    reason: 'پیگیری مدیر برای تسک: ' + (task?task.title:taskId),
    ref_task_id: taskId
  }).then(function(){
    showToast('⚠ ۱۰ امتیاز از گزارش‌دهی کسر شد');
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

window._tkPickCenter = function() {
  // Simple prompt-based for now; could be enhanced with search modal
  var name = prompt('نام مرکز را وارد کنید:');
  if (name) {
    var inp = document.getElementById('tkT_cname');
    if (inp) inp.value = name;
  }
};

// ── Columns Modal ─────────────────────────────────────────────────────────
window._tkOpenColsModal = function() {
  var cols = _tkGetColumns();
  var body = '<div id="tkColsList">' + _tkRenderColsList(cols) + '</div>' +
    '<button type="button" class="tk-btn tk-btn-outline" style="margin-top:8px" onclick="_tkAddCol()">+ ستون جدید</button>';
  var foot = '<button class="btn-secondary" onclick="closeModal(\'tkColsModal\')">انصراف</button>' +
    '<button class="btn-primary" onclick="_tkSaveCols()">💾 ذخیره</button>';
  openModal('tkColsModal', '⚙️ مدیریت ستون‌های کانبان', body, foot);
};

function _tkRenderColsList(cols) {
  return cols.map(function(c, i){
    return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">' +
      '<input type="text" class="m-inp" value="'+esc(c.label)+'" style="flex:1" data-col-i="'+i+'">' +
      '<input type="color" value="'+c.color+'" style="width:40px;padding:2px" data-col-ci="'+i+'">' +
      '<button type="button" class="tk-icon-btn" onclick="this.parentElement.remove()">✕</button>' +
    '</div>';
  }).join('');
}

window._tkAddCol = function() {
  var list = document.getElementById('tkColsList');
  if (!list) return;
  var i = list.children.length;
  var div = document.createElement('div');
  div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px';
  div.innerHTML = '<input type="text" class="m-inp" value="ستون جدید" style="flex:1" data-col-i="'+i+'">' +
    '<input type="color" value="#6366f1" style="width:40px;padding:2px" data-col-ci="'+i+'">' +
    '<button type="button" class="tk-icon-btn" onclick="this.parentElement.remove()">✕</button>';
  list.appendChild(div);
};

window._tkSaveCols = function() {
  var list = document.getElementById('tkColsList');
  if (!list) return;
  var cols = [];
  list.querySelectorAll('div').forEach(function(row, i){
    var label = (row.querySelector('[data-col-i]')||{}).value||'';
    var color = (row.querySelector('[data-col-ci]')||{}).value||'#6366f1';
    if (label.trim()) cols.push({id: 'col_'+(i+1)+'_'+Date.now(), label: label.trim(), color: color});
  });
  if (!cols.length) { showToast('⚠ حداقل یک ستون لازم است'); return; }
  var newSettings = Object.assign({}, _tkSettings, {columns: cols});
  _tkAPI('PUT', '/settings', newSettings).then(function(){
    _tkSettings = newSettings;
    closeModal('tkColsModal');
    showToast('✅ ستون‌ها ذخیره شد');
    _tkRenderView();
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

// ── KPI View ──────────────────────────────────────────────────────────────
function _tkRenderKPI() {
  var area = document.getElementById('tkViewArea');
  if (!area) return;
  var isManager = _tkIsManager();
  var kd = _tkKPIData;
  var scores = kd ? (kd.finalized ? {
    customs: kd.data.score_customs,
    sla: kd.data.score_sla,
    traceability: kd.data.score_traceability,
    reporting: kd.data.score_reporting,
    teamwork: kd.data.score_teamwork
  } : kd.live ? kd.live.scores : null) : null;
  var avg = kd ? (kd.finalized ? parseFloat(kd.data.avg_score) : (kd.live ? kd.live.avg : 0)) : 0;
  var gatePassed = avg >= 80;
  var finalized = kd && kd.finalized;

  var html = '<div class="tk-kpi-header">' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<label style="font-size:12px;color:var(--text-muted)">ماه:</label>' +
      '<input type="text" id="tkMonthInp" value="'+esc(_tkMonth)+'" class="m-inp" style="width:100px" readonly onclick="openJDP(this,_tkChangeMonth)" placeholder="YYYY/MM">' +
      (isManager && !finalized ? '<button class="tk-btn tk-btn-primary" onclick="_tkFinalizeMonth()">📌 نهایی کردن ماه</button>' : '') +
      (finalized ? '<span style="background:#dcfce7;color:#16a34a;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700">✅ نهایی شده</span>' : '') +
    '</div>' +
  '</div>';

  // Super-admin salary section
  if (_tkIsSuperAdmin()) {
    html += '<div class="tk-salary-box" id="tkSalarySection"><div style="color:var(--text-muted);font-size:12px">در حال بارگذاری حقوق…</div></div>';
  }

  // Average gauge
  var avgColor = avg >= 80 ? '#22c55e' : avg >= 60 ? '#f59e0b' : '#ef4444';
  html += '<div class="tk-kpi-gate" style="border-color:'+avgColor+';">' +
    '<div class="tk-gate-score" style="color:'+avgColor+'">' + avg.toFixed(1) + '</div>' +
    '<div class="tk-gate-label">' + (gatePassed ? '✅ دروازه باز — پاداش ۵ میلیون تومان' : '🔴 دروازه بسته — پاداش صفر') + '</div>' +
    '<div class="tk-gate-sub">میانگین ۵ شاخص | حد قبولی: ۸۰</div>' +
  '</div>';

  // 5 indicators
  html += '<div class="tk-indicators">';
  _TK_INDICATORS.forEach(function(ind) {
    var sc = scores ? (scores[ind.id] || 0) : 100;
    var iColor = sc >= 80 ? '#22c55e' : sc >= 60 ? '#f59e0b' : '#ef4444';
    html += '<div class="tk-ind-card">' +
      '<div class="tk-ind-title">'+esc(ind.label)+'</div>' +
      '<div class="tk-ind-gauge-wrap">' +
        '<div class="tk-ind-gauge-bg"><div class="tk-ind-gauge-fill" style="width:'+sc+'%;background:'+iColor+'"></div></div>' +
        '<span class="tk-ind-score" style="color:'+iColor+'">'+sc+'</span>' +
      '</div>' +
      (isManager && !finalized ?
        '<button class="tk-btn tk-btn-outline" style="font-size:11px;margin-top:6px" onclick="_tkOpenDeductModal(\''+ind.id+'\',\''+esc(ind.label)+'\','+ind.defPts+')">− ثبت کسر</button>'
      : '') +
    '</div>';
  });
  html += '</div>';

  // Deductions log
  var deds = _tkDeductions;
  if (deds.length) {
    html += '<div class="tk-section-title">📋 لاگ کسرهای این ماه</div>' +
    '<table class="tk-table"><thead><tr><th>شاخص</th><th>امتیاز</th><th>دلیل</th><th>ثبت‌کننده</th>' + (isManager ? '<th></th>' : '') + '</tr></thead><tbody>' +
    deds.map(function(d){
      var indLabel = (_TK_INDICATORS.find(function(i){return i.id===d.indicator;})||{}).label || d.indicator;
      return '<tr>' +
        '<td>'+esc(indLabel)+'</td>' +
        '<td style="color:#ef4444;font-weight:700">−'+d.points+'</td>' +
        '<td>'+esc(d.reason)+'</td>' +
        '<td>'+esc(d.registered_by||'')+'</td>' +
        (isManager ? '<td><button class="tk-icon-btn" onclick="_tkDeleteDeduction(\''+d.id+'\')">🗑</button></td>' : '') +
      '</tr>';
    }).join('') +
    '</tbody></table>';
  } else if (!finalized) {
    html += '<div style="color:var(--text-muted);font-size:12px;padding:12px 0">هنوز کسری ثبت نشده — همه شاخص‌ها ۱۰۰ هستند</div>';
  }

  // History sparkline
  if (_tkHistory.length) {
    html += '<div class="tk-section-title">📈 تاریخچه ۶ ماه گذشته</div>' +
      '<div class="tk-sparkline">';
    _tkHistory.slice(0,6).reverse().forEach(function(h){
      var sc = parseFloat(h.avg_score)||0;
      var c = sc>=80?'#22c55e':sc>=60?'#f59e0b':'#ef4444';
      html += '<div class="tk-spark-bar-wrap" title="'+h.month+': '+sc.toFixed(1)+'">' +
        '<div class="tk-spark-bar" style="height:'+Math.round(sc*0.7)+'px;background:'+c+'"></div>' +
        '<div class="tk-spark-label">'+h.month.slice(5)+'</div>' +
        '<div class="tk-spark-score" style="color:'+c+'">'+sc.toFixed(0)+'</div>' +
      '</div>';
    });
    html += '</div>';
  }

  area.innerHTML = html;

  // Load salary for super-admin
  if (_tkIsSuperAdmin() && _tkEmployee) {
    _tkLoadSalary();
  }
}

function _tkLoadSalary() {
  _tkAPI('GET', '/salary/'+encodeURIComponent(_tkEmployee)).then(function(data){
    var sec = document.getElementById('tkSalarySection');
    if (!sec) return;
    _tkSalaryData = data;
    sec.innerHTML = '<div class="tk-salary-inner">' +
      '<span style="font-weight:700;color:var(--text-primary)">💼 حقوق پایه (سوپر ادمین):</span> ' +
      '<span style="color:#6366f1;font-size:16px;font-weight:700">' +
        (data.salary_amount ? _tkFmt(data.salary_amount) + ' تومان' : 'تنظیم نشده') +
      '</span>' +
      ' <button class="tk-btn tk-btn-outline" style="font-size:11px" onclick="_tkEditSalary()">✏️ ویرایش</button>' +
    '</div>';
  }).catch(function(){});
}

window._tkEditSalary = function() {
  var cur = _tkSalaryData ? _tkSalaryData.salary_amount : '';
  var val = prompt('حقوق پایه (تومان):', cur||'30000000');
  if (val === null) return;
  _tkAPI('PUT', '/salary/'+encodeURIComponent(_tkEmployee), {salary_amount: parseFloat(val)||0}).then(function(){
    showToast('✅ حقوق ذخیره شد');
    _tkLoadSalary();
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

window._tkChangeMonth = function(v) {
  _tkMonth = v.slice(0,7);
  var inp = document.getElementById('tkMonthInp');
  if (inp) inp.value = _tkMonth;
  _tkLoadAll().then(_tkRenderView);
};

window._tkOpenDeductModal = function(indicatorId, indicatorLabel, defPts) {
  var body = '<div class="m-2col">' +
    '<div style="grid-column:1/-1"><label>شاخص</label><input class="m-inp" value="'+esc(indicatorLabel)+'" disabled></div>' +
    '<div><label>امتیاز کسر *</label><input id="dedPts" class="m-inp" type="number" min="1" max="100" value="'+defPts+'"></div>' +
    '<div><label>دلیل *</label><input id="dedReason" class="m-inp" placeholder="توضیح کوتاه..."></div>' +
  '</div>';
  var foot = '<button class="btn-secondary" onclick="closeModal(\'tkDedModal\')">انصراف</button>' +
    '<button class="btn-primary" onclick="_tkSubmitDeduction(\''+indicatorId+'\')">ثبت</button>';
  openModal('tkDedModal', '− ثبت کسر امتیاز', body, foot);
};

window._tkSubmitDeduction = function(ind) {
  var pts = parseInt((document.getElementById('dedPts')||{}).value||0);
  var reason = (document.getElementById('dedReason')||{}).value||'';
  if (!pts || !reason.trim()) { showToast('⚠ همه فیلدها الزامی'); return; }
  _tkAPI('POST', '/deductions', {
    employee: _tkEmployee, month: _tkMonth,
    indicator: ind, points: pts, reason: reason.trim()
  }).then(function(){
    closeModal('tkDedModal');
    showToast('✅ کسر ثبت شد');
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

window._tkDeleteDeduction = function(id) {
  if (!confirm('این کسر حذف شود؟')) return;
  _tkAPI('DELETE', '/deductions/'+id).then(function(){
    showToast('حذف شد');
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

window._tkFinalizeMonth = function() {
  if (!confirm('نهایی کردن ماه ' + _tkMonth + '؟\nبعد از نهایی کردن، نمرات قفل می‌شوند.')) return;
  _tkAPI('POST', '/finalize/'+encodeURIComponent(_tkEmployee)+'/'+encodeURIComponent(_tkMonth), {}).then(function(r){
    var bonus = r.bonus ? _tkFmt(r.bonus) + ' تومان' : 'صفر';
    showToast((r.live.gate_passed ? '✅ دروازه باز — پاداش: ' : '🔴 دروازه بسته — پاداش: ') + bonus, 4000);
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

// ── Projects View ─────────────────────────────────────────────────────────
function _tkRenderProjects() {
  var area = document.getElementById('tkViewArea');
  if (!area) return;
  var isManager = _tkIsManager();

  var html = '<div class="tk-projects-grid">';
  Object.keys(_TK_PROJECTS).forEach(function(type) {
    var proj = _TK_PROJECTS[type];
    var milestones = _tkMilestones.filter(function(m){ return m.project_type === type; });
    var totalBonus = milestones.filter(function(m){ return ['approved','paid'].includes(m.status); })
      .reduce(function(s,m){ return s + parseFloat(m.bonus_amount||0); }, 0);

    html += '<div class="tk-proj-card">' +
      '<div class="tk-proj-head">' +
        '<span class="tk-proj-icon">'+proj.icon+'</span>' +
        '<span class="tk-proj-label">'+esc(proj.label)+'</span>' +
      '</div>' +
      '<div class="tk-proj-desc">'+esc(proj.desc)+'</div>' +
      '<div class="tk-proj-metric">متریک: '+esc(proj.metric)+'</div>' +
      (totalBonus ? '<div class="tk-proj-bonus">پاداش تأیید شده: '+_tkFmt(totalBonus)+' ت</div>' : '') +
      '<div class="tk-proj-milestones">' +
      (milestones.length ? milestones.map(function(m){
        var stColor = {pending:'#94a3b8',achieved:'#f59e0b',approved:'#22c55e',paid:'#6366f1',cancelled:'#ef4444'};
        var stLabel = {pending:'ثبت شده',achieved:'محقق شده',approved:'تأیید شد',paid:'پرداخت شد',cancelled:'لغو'};
        return '<div class="tk-milestone">' +
          '<span class="tk-ms-status" style="background:'+(stColor[m.status]||'#94a3b8')+'20;color:'+(stColor[m.status]||'#94a3b8')+'">'+esc(stLabel[m.status]||m.status)+'</span>' +
          '<span class="tk-ms-title">'+esc(m.title)+'</span>' +
          (m.bonus_amount ? '<span class="tk-ms-bonus">'+_tkFmt(m.bonus_amount)+' ت</span>' : '') +
          (isManager && m.status === 'pending' ?
            '<button class="tk-icon-btn" onclick="_tkApproveMilestone(\''+m.id+'\')">✓</button>' +
            '<button class="tk-icon-btn" onclick="_tkRejectMilestone(\''+m.id+'\')">✕</button>' : '') +
          (isManager && m.status === 'approved' ?
            '<button class="tk-icon-btn" onclick="_tkPayMilestone(\''+m.id+'\')">💳</button>' : '') +
        '</div>';
      }).join('') : '<div style="color:var(--text-muted);font-size:11px">هنوز دستاوردی ثبت نشده</div>') +
      '</div>' +
      '<button class="tk-btn tk-btn-outline" style="width:100%;margin-top:8px;font-size:12px" onclick="_tkOpenMilestoneModal(\''+type+'\')">+ ثبت دستاورد</button>' +
    '</div>';
  });
  html += '</div>';
  area.innerHTML = html;
}

window._tkOpenMilestoneModal = function(type) {
  var proj = _TK_PROJECTS[type];
  var body = '<div class="m-2col">' +
    '<div style="grid-column:1/-1"><label>پروژه</label><input class="m-inp" value="'+esc(proj.label)+'" disabled></div>' +
    '<div style="grid-column:1/-1"><label>عنوان دستاورد *</label><input id="msTitle" class="m-inp" placeholder="توضیح کوتاه..."></div>' +
    '<div><label>مقدار متریک</label><input id="msMetric" class="m-inp" type="number" placeholder="'+esc(proj.metric)+'"></div>' +
    '<div><label>واحد</label><input id="msUnit" class="m-inp" value="'+esc(proj.unit)+'" placeholder="rial/dollar/days/count"></div>' +
    '<div><label>پاداش پیشنهادی (تومان)</label><input id="msBonus" class="m-inp" type="number" min="0"></div>' +
    '<div><label>تاریخ تحقق (شمسی)</label><input id="msDate" class="m-inp" readonly onclick="openJDP(this,function(v){document.getElementById(\'msDate\').value=v})" style="cursor:pointer"></div>' +
    '<div style="grid-column:1/-1"><label>توضیحات</label><textarea id="msDesc" class="m-inp" rows="2" placeholder="جزئیات بیشتر..."></textarea></div>' +
  '</div>';
  var foot = '<button class="btn-secondary" onclick="closeModal(\'tkMsModal\')">انصراف</button>' +
    '<button class="btn-primary" onclick="_tkSubmitMilestone(\''+type+'\')">ثبت</button>';
  openModal('tkMsModal', proj.icon + ' ثبت دستاورد — ' + proj.label, body, foot);
};

window._tkSubmitMilestone = function(type) {
  var title = (document.getElementById('msTitle')||{}).value||'';
  if (!title.trim()) { showToast('⚠ عنوان الزامی'); return; }
  _tkAPI('POST', '/milestones', {
    employee: _tkEmployee, project_type: type,
    title: title.trim(),
    description: (document.getElementById('msDesc')||{}).value||null,
    metric_value: parseFloat((document.getElementById('msMetric')||{}).value)||null,
    metric_unit: (document.getElementById('msUnit')||{}).value||null,
    bonus_amount: parseFloat((document.getElementById('msBonus')||{}).value)||null,
    achieved_at: (document.getElementById('msDate')||{}).value||null
  }).then(function(){
    closeModal('tkMsModal');
    showToast('✅ دستاورد ثبت شد');
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

window._tkApproveMilestone = function(id) {
  _tkAPI('PUT', '/milestones/'+id, {status:'approved'}).then(function(){
    showToast('✅ تأیید شد');
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};
window._tkRejectMilestone = function(id) {
  _tkAPI('PUT', '/milestones/'+id, {status:'cancelled'}).then(function(){
    showToast('رد شد');
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};
window._tkPayMilestone = function(id) {
  _tkAPI('PUT', '/milestones/'+id, {status:'paid'}).then(function(){
    showToast('✅ پرداخت ثبت شد');
    _tkLoadAll().then(_tkRenderView);
  }).catch(function(e){ showToast('⚠ ' + e.message); });
};

// ── Styles ────────────────────────────────────────────────────────────────
function _addTKStyles() {
  if (document.getElementById('_tk_styles')) return;
  var s = document.createElement('style');
  s.id = '_tk_styles';
  s.textContent = `
.tk-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px}
.tk-tabs{display:flex;gap:4px;background:var(--bg-raised);border-radius:8px;padding:4px}
.tk-tab{background:none;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;font-family:Vazirmatn,sans-serif;font-size:12px;font-weight:600;color:var(--text-muted);transition:all .15s}
.tk-tab:hover{background:var(--bg-input)}
.tk-tab.active{background:#6366f1;color:#fff}
.tk-btn{border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-family:Vazirmatn,sans-serif;font-size:12px;font-weight:600;transition:all .15s}
.tk-btn-primary{background:#6366f1;color:#fff}
.tk-btn-primary:hover{background:#5254cc}
.tk-btn-outline{background:var(--bg-raised);color:var(--text-secondary);border:1px solid var(--border-input)}
.tk-btn-outline:hover{border-color:#6366f1;color:#6366f1}
.tk-icon-btn{background:none;border:1px solid var(--border-input);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:11px;color:var(--text-muted)}
.tk-icon-btn:hover{border-color:#6366f1;color:#6366f1}
.btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;padding:6px 12px;cursor:pointer;font-family:Vazirmatn,sans-serif;font-size:12px}

/* Kanban */
.tk-task-header{margin-bottom:12px}
.tk-kanban{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;min-height:300px}
.tk-col{min-width:220px;max-width:280px;flex:0 0 240px;background:var(--bg-raised);border-radius:10px;padding:10px}
.tk-col-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding:6px 8px;border-radius:6px;background:var(--bg-input)}
.tk-col-title{font-size:12px;font-weight:700;color:var(--text-primary)}
.tk-col-count{font-size:10px;padding:1px 7px;border-radius:10px;font-weight:700}
.tk-col-body{display:flex;flex-direction:column;gap:8px}
.tk-card{background:var(--bg-primary);border-radius:8px;padding:10px;cursor:pointer;border:1px solid var(--border-input);transition:box-shadow .15s}
.tk-card:hover{box-shadow:0 2px 8px rgba(99,102,241,.2);border-color:#6366f1}
.tk-card-title{font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:6px}
.tk-card-center{font-size:10px;color:#6366f1;margin-bottom:4px;cursor:pointer;text-decoration:underline dotted}
.tk-card-meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px}
.tk-pill{font-size:10px;padding:1px 7px;border-radius:10px;font-weight:600}
.tk-sla{font-size:10px;font-weight:600;padding:1px 7px;border-radius:10px}
.sla-ok{background:#dcfce720;color:#16a34a}
.sla-warn{background:#fef9c320;color:#ca8a04}
.sla-over{background:#fee2e220;color:#dc2626}
.tk-progress-wrap{height:4px;background:var(--bg-raised);border-radius:2px;margin:4px 0;overflow:hidden}
.tk-progress-bar{height:100%;border-radius:2px;transition:width .3s}
.tk-card-actions{margin-top:6px;display:flex;gap:4px}
.tk-add-card{background:none;border:1px dashed var(--border-input);border-radius:6px;padding:6px;width:100%;cursor:pointer;color:var(--text-muted);font-size:11px;font-family:Vazirmatn,sans-serif;margin-top:4px}
.tk-add-card:hover{border-color:#6366f1;color:#6366f1}

/* Stages */
.tk-stage{background:var(--bg-raised);border-radius:6px;padding:8px;margin-bottom:6px}
.tk-stage-head{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.tk-stage-inp{flex:1;border:none;background:transparent;font-family:Vazirmatn,sans-serif;font-size:13px;font-weight:600;color:var(--text-primary);outline:none;border-bottom:1px dashed var(--border-input)}
.tk-ops{margin-right:16px;display:flex;flex-direction:column;gap:4px}
.tk-op{display:flex;align-items:center;gap:6px}
.tk-op-inp{flex:1;border:none;background:transparent;font-family:Vazirmatn,sans-serif;font-size:12px;color:var(--text-secondary);outline:none;border-bottom:1px dashed var(--border-input)}
.tk-add-op{background:none;border:1px dashed var(--border-input);border-radius:4px;padding:3px 8px;cursor:pointer;color:var(--text-muted);font-size:11px;font-family:Vazirmatn,sans-serif;margin-top:4px}

/* KPI */
.tk-kpi-header{margin-bottom:16px;padding:12px;background:var(--bg-raised);border-radius:8px}
.tk-salary-box{background:#f0f4ff;border:1px solid #c7d2fe;border-radius:8px;padding:10px 14px;margin-bottom:12px}
.tk-salary-inner{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.tk-kpi-gate{border:2px solid;border-radius:12px;padding:20px;text-align:center;margin-bottom:20px}
.tk-gate-score{font-size:48px;font-weight:900;line-height:1}
.tk-gate-label{font-size:14px;font-weight:700;margin-top:6px}
.tk-gate-sub{font-size:11px;color:var(--text-muted);margin-top:4px}
.tk-indicators{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.tk-ind-card{background:var(--bg-raised);border-radius:8px;padding:12px}
.tk-ind-title{font-size:11px;font-weight:600;color:var(--text-primary);margin-bottom:8px;line-height:1.4}
.tk-ind-gauge-wrap{display:flex;align-items:center;gap:8px}
.tk-ind-gauge-bg{flex:1;height:8px;background:var(--bg-input);border-radius:4px;overflow:hidden}
.tk-ind-gauge-fill{height:100%;border-radius:4px;transition:width .5s}
.tk-ind-score{font-size:18px;font-weight:900;min-width:36px;text-align:left}
.tk-section-title{font-size:13px;font-weight:700;color:var(--text-primary);margin:16px 0 8px}
.tk-table{width:100%;border-collapse:collapse;font-size:12px}
.tk-table th,.tk-table td{padding:7px 10px;border-bottom:1px solid var(--border-input);text-align:right}
.tk-table th{font-weight:700;background:var(--bg-raised);color:var(--text-muted)}
.tk-sparkline{display:flex;gap:8px;align-items:flex-end;padding:12px;background:var(--bg-raised);border-radius:8px}
.tk-spark-bar-wrap{display:flex;flex-direction:column;align-items:center;gap:2px;flex:1}
.tk-spark-bar{width:24px;border-radius:3px 3px 0 0;transition:height .3s;min-height:4px}
.tk-spark-label{font-size:10px;color:var(--text-muted)}
.tk-spark-score{font-size:11px;font-weight:700}

/* Projects */
.tk-projects-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.tk-proj-card{background:var(--bg-raised);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:8px}
.tk-proj-head{display:flex;align-items:center;gap:8px}
.tk-proj-icon{font-size:22px}
.tk-proj-label{font-size:13px;font-weight:700;color:var(--text-primary)}
.tk-proj-desc{font-size:11px;color:var(--text-muted);line-height:1.5}
.tk-proj-metric{font-size:11px;color:#6366f1;font-weight:600}
.tk-proj-bonus{font-size:12px;color:#22c55e;font-weight:700;background:#dcfce720;border-radius:6px;padding:4px 8px}
.tk-proj-milestones{display:flex;flex-direction:column;gap:4px;flex:1}
.tk-milestone{display:flex;align-items:center;gap:6px;font-size:11px;flex-wrap:wrap}
.tk-ms-status{padding:1px 6px;border-radius:8px;font-size:10px;font-weight:700}
.tk-ms-title{flex:1;color:var(--text-secondary)}
.tk-ms-bonus{color:#22c55e;font-weight:700}
.m-inp{width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--border-input);border-radius:6px;background:var(--bg-input);color:var(--text-primary);font-family:Vazirmatn,sans-serif;font-size:12px}
.m-inp:focus{outline:none;border-color:#6366f1}
.m-2col{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.m-2col label{display:block;font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px}
`;
  document.head.appendChild(s);
}
