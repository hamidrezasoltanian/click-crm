/* Week Planner — تخصیص برنامه هفتگی توسط مدیر */
(function () {
  'use strict';

  var _wpState = {
    expertId: '',
    weekId: '',       // weekId of selected week (Jalali start of week)
    weekEnd: '',      // Jalali end of week
    customStart: '',
    customEnd: '',
    mode: 'week',     // 'week' | '3day' | 'custom'
    actionType: 'call',
    centers: [],      // loaded centers for expert
    selected: {},     // {centerId: dayOverride or ''}
    filter: 'priority', // 'priority' | 'p1' | 'p2' | 'overdue' | 'all'
  };

  // ── helpers ──────────────────────────────────────────────────────────────

  function _todayJ() {
    return typeof todayJ === 'function' ? todayJ() : (function(){
      var d = new Date();
      return typeof g2j === 'function' ? g2j(d.getFullYear(), d.getMonth()+1, d.getDate()) : [d.getFullYear()-621, d.getMonth()+1, d.getDate()];
    })();
  }

  function _todayStr() {
    var t = _todayJ();
    return t[0] + '/' + p2(t[1]) + '/' + p2(t[2]);
  }

  function _workDays(startStr, endStr) {
    // Returns array of work-day Jalali date strings (skip Friday = jDow 6)
    var days = [];
    var parts = startStr.split('/').map(Number);
    var cur = [parts[0], parts[1], parts[2]];
    var endParts = endStr.split('/').map(Number);
    var endMs = jMs(endParts[0], endParts[1], endParts[2]);
    var safety = 0;
    while (jMs(cur[0], cur[1], cur[2]) <= endMs && safety++ < 60) {
      var dow = jDow(cur[0], cur[1], cur[2]); // 0=Sat … 5=Thu 6=Fri
      if (dow !== 6) days.push(cur[0] + '/' + p2(cur[1]) + '/' + p2(cur[2]));
      var next = jAdd(cur[0], cur[1], cur[2], 1);
      cur = [next[0], next[1], next[2]];
    }
    return days;
  }

  function _dayLabel(jalaliDate) {
    if (!jalaliDate) return '';
    var parts = jalaliDate.split('/').map(Number);
    var dow = jDow(parts[0], parts[1], parts[2]);
    var names = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
    return (names[dow]||'') + ' ' + jalaliDate.slice(5);
  }

  function _isOverdue(fd) {
    return fd && fd < _todayStr();
  }

  function _daysSince(jalaliDate) {
    if (!jalaliDate) return null;
    try {
      var parts = jalaliDate.split('/').map(Number);
      var g = j2g(parts[0], parts[1], parts[2]);
      return Math.round((Date.now() - new Date(g[0], g[1]-1, g[2]).getTime()) / 86400000);
    } catch(e) { return null; }
  }

  // Spread centers across work days evenly
  function _autoSpread(centerIds, workDays) {
    if (!workDays.length) return {};
    var map = {};
    centerIds.forEach(function(id, idx) {
      map[id] = workDays[idx % workDays.length];
    });
    return map;
  }

  // ── load centers for expert ───────────────────────────────────────────────

  function _loadCenters(expertId) {
    if (typeof _buildPCCache === 'function') _buildPCCache();
    var db = window.DB || {};
    var edits = db.edits || {};
    var today = _todayStr();
    var centers = [];

    // Scan all provinces
    if (typeof getAllProvinces === 'function') {
      getAllProvinces().forEach(function(p) {
        var rtype = typeof getProvType === 'function' ? getProvType(p.id) : (p.id === 'tehran' ? 'center' : 'pc');
        var provCenters = typeof getProvCenters === 'function' ? getProvCenters(p.id) : [];
        provCenters.forEach(function(c) {
          var e = edits[rtype + '_' + c.id] || {};
          var owner = e.owner || c.owner || '';
          if (owner !== expertId) return;
          var status = e.status || '';
          if (['غیرفعال'].includes(status)) return;

          var fd = e.followupDate || '';
          var potential = parseInt(e.potential) || 4;
          var lastChangeMs = e._lastActivity || 0;
          var daysSinceContact = lastChangeMs ? Math.round((Date.now() - lastChangeMs) / 86400000) : null;

          // Already scheduled this week?
          var weekEntries = db.weekEntries || {};
          var alreadyScheduled = Object.values(weekEntries).some(function(we) {
            return we.rtype === rtype && we.rid === c.id && !we.done &&
              we.scheduledDate >= _wpState.weekId && we.scheduledDate <= _wpState.weekEnd;
          });

          centers.push({
            id: c.id,
            rtype: rtype,
            rkey: rtype + '_' + c.id,
            name: e.nameOverride || c.name || c.id,
            potential: potential,
            status: status,
            followupDate: fd,
            isOverdue: _isOverdue(fd),
            daysSince: daysSinceContact,
            alreadyScheduled: alreadyScheduled,
            provId: p.id,
          });
        });
      });
    }

    // Sort: overdue first, then by potential, then by days since contact
    centers.sort(function(a, b) {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      if (a.potential !== b.potential) return a.potential - b.potential;
      var da = a.daysSince || 0, db2 = b.daysSince || 0;
      return db2 - da;
    });

    _wpState.centers = centers;
  }

  // ── compute date range from mode ─────────────────────────────────────────

  function _computeRange() {
    var mode = _wpState.mode;
    if (mode === 'week') {
      // already set from week selector
      return { start: _wpState.weekId, end: _wpState.weekEnd };
    }
    if (mode === '3day') {
      var t = _todayJ();
      var start = jAdd(t[0], t[1], t[2], 1);
      // find 3 work days
      var days = [];
      var cur = [start[0], start[1], start[2]];
      while (days.length < 3) {
        if (jDow(cur[0], cur[1], cur[2]) !== 6) days.push(cur.slice());
        cur = jAdd(cur[0], cur[1], cur[2], 1);
      }
      var s = days[0][0]+'/'+p2(days[0][1])+'/'+p2(days[0][2]);
      var e = days[2][0]+'/'+p2(days[2][1])+'/'+p2(days[2][2]);
      _wpState.weekId = s;
      _wpState.weekEnd = e;
      return { start: s, end: e };
    }
    if (mode === 'custom') {
      _wpState.weekId = _wpState.customStart;
      _wpState.weekEnd = _wpState.customEnd;
      return { start: _wpState.customStart, end: _wpState.customEnd };
    }
    return { start: '', end: '' };
  }

  // ── render ────────────────────────────────────────────────────────────────

  window.renderWeekPlannerPanel = function () {
    var el = document.getElementById('weekPlannerPanel');
    if (!el) return;

    var users = typeof _DEFAULT_MEMBERS !== 'undefined' ? _DEFAULT_MEMBERS : [];
    var experts = users.filter(function(u) {
      return u.active !== false && ['کارشناس فروش','کارشناس بازرگانی'].includes(u.role);
    });

    // Week options
    var weeks = typeof wpGetWeeks === 'function' ? wpGetWeeks() : [];
    var currentWeekId = typeof wpCurrentWeekId === 'function' ? wpCurrentWeekId() : '';
    if (!_wpState.weekId && currentWeekId) {
      var cw = weeks.find(function(w) { return w.id === currentWeekId; });
      if (cw) { _wpState.weekId = cw.wsStr; _wpState.weekEnd = cw.weStr; }
    }

    var expertOpts = experts.map(function(u) {
      return '<option value="' + esc(u.id) + '"' + (_wpState.expertId === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>';
    }).join('');

    var weekOpts = weeks.filter(function(w) { return !w.isPast; }).map(function(w) {
      return '<option value="' + w.wsStr + '|' + w.weStr + '"' + (_wpState.weekId === w.wsStr ? ' selected' : '') + '>' + esc(w.label) + (w.isCurrent ? ' ← این هفته' : '') + '</option>';
    }).join('');

    el.innerHTML =
      '<div style="max-width:1000px;margin:0 auto">' +
      '<h2 style="margin:0 0 18px;font-size:1.2rem;font-weight:700;color:#1e293b">📋 تخصیص برنامه هفتگی</h2>' +

      // Config row
      '<div style="background:#fff;border-radius:12px;padding:18px 20px;border:1px solid #e2e8f0;margin-bottom:16px">' +
        '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">' +

          '<div style="flex:1;min-width:160px">' +
            '<label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:5px">کارشناس</label>' +
            '<select id="wpExpertSel" onchange="window._wpOnExpertChange(this.value)" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-family:inherit;font-size:.9rem">' +
              '<option value="">— انتخاب کنید —</option>' + expertOpts +
            '</select>' +
          '</div>' +

          '<div style="flex:1;min-width:160px">' +
            '<label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:5px">بازه</label>' +
            '<div style="display:flex;gap:4px">' +
              ['week','3day','custom'].map(function(m) {
                var lbl = {week:'هفتگی', '3day':'۳ روز', custom:'دلخواه'}[m];
                return '<button onclick="window._wpSetMode(\'' + m + '\')" style="flex:1;padding:7px 4px;border:1px solid ' + (_wpState.mode === m ? '#6366f1' : '#e2e8f0') + ';border-radius:7px;font-family:inherit;font-size:.82rem;cursor:pointer;background:' + (_wpState.mode === m ? '#6366f1' : '#fff') + ';color:' + (_wpState.mode === m ? '#fff' : '#374151') + '">' + lbl + '</button>';
              }).join('') +
            '</div>' +
          '</div>' +

          (_wpState.mode === 'week'
            ? '<div style="flex:2;min-width:200px">' +
                '<label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:5px">هفته</label>' +
                '<select id="wpWeekSel" onchange="window._wpOnWeekChange(this.value)" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-family:inherit;font-size:.85rem">' +
                  weekOpts +
                '</select>' +
              '</div>'
            : _wpState.mode === 'custom'
              ? '<div style="flex:1;min-width:120px">' +
                  '<label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:5px">از</label>' +
                  '<input type="text" id="wpCustomStart" placeholder="۱۴۰۴/۰۳/۱۵" value="' + (_wpState.customStart||'') + '" onchange="_wpState.customStart=this.value" style="width:100%;padding:7px 9px;border:1px solid #e2e8f0;border-radius:7px;font-family:inherit;font-size:.85rem;box-sizing:border-box">' +
                '</div>' +
                '<div style="flex:1;min-width:120px">' +
                  '<label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:5px">تا</label>' +
                  '<input type="text" id="wpCustomEnd" placeholder="۱۴۰۴/۰۳/۱۸" value="' + (_wpState.customEnd||'') + '" onchange="_wpState.customEnd=this.value" style="width:100%;padding:7px 9px;border:1px solid #e2e8f0;border-radius:7px;font-family:inherit;font-size:.85rem;box-sizing:border-box">' +
                '</div>'
              : '<div style="flex:1;min-width:200px;padding:8px 12px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;font-size:.83rem;color:#15803d;display:flex;align-items:center">📅 ۳ روز کاری از فردا</div>') +

          '<div style="min-width:110px">' +
            '<label style="display:block;font-size:.78rem;font-weight:600;color:#374151;margin-bottom:5px">نوع پیش‌فرض</label>' +
            '<select id="wpActionType" onchange="_wpState.actionType=this.value" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-family:inherit;font-size:.9rem">' +
              '<option value="call"' + (_wpState.actionType==='call'?' selected':'') + '>📞 تماس</option>' +
              '<option value="visit"' + (_wpState.actionType==='visit'?' selected':'') + '>🤝 ملاقات</option>' +
            '</select>' +
          '</div>' +

          '<button onclick="window._wpLoadCenters()" style="padding:9px 20px;background:#6366f1;color:white;border:none;border-radius:8px;font-family:inherit;font-size:.9rem;cursor:pointer;font-weight:600;white-space:nowrap">بارگذاری مراکز ▼</button>' +

        '</div>' +
      '</div>' +

      // Center list
      '<div id="wpCenterList"></div>' +

      '</div>';
  };

  window._wpSetMode = function(mode) {
    _wpState.mode = mode;
    window.renderWeekPlannerPanel();
  };

  window._wpOnExpertChange = function(val) {
    _wpState.expertId = val;
    _wpState.selected = {};
  };

  window._wpOnWeekChange = function(val) {
    var parts = val.split('|');
    _wpState.weekId = parts[0] || '';
    _wpState.weekEnd = parts[1] || '';
  };

  window._wpLoadCenters = function() {
    var expertId = (document.getElementById('wpExpertSel')||{}).value || _wpState.expertId;
    _wpState.expertId = expertId;
    _wpState.actionType = (document.getElementById('wpActionType')||{}).value || _wpState.actionType;
    if (_wpState.mode === 'custom') {
      _wpState.customStart = (document.getElementById('wpCustomStart')||{}).value.trim();
      _wpState.customEnd   = (document.getElementById('wpCustomEnd')||{}).value.trim();
    }

    if (!expertId) { if (typeof showToast==='function') showToast('کارشناس را انتخاب کنید'); return; }

    var range = _computeRange();
    if (!range.start || !range.end) { if (typeof showToast==='function') showToast('بازه زمانی را تعریف کنید'); return; }

    _loadCenters(expertId);
    _wpState.selected = {};
    _wpRenderList(range);
  };

  function _wpRenderList(range) {
    var el = document.getElementById('wpCenterList');
    if (!el) return;

    var centers = _wpState.centers;
    var workDays = _workDays(range.start, range.end);
    var expertName = '';
    var members = typeof _DEFAULT_MEMBERS !== 'undefined' ? _DEFAULT_MEMBERS : [];
    var m = members.find(function(u){ return u.id === _wpState.expertId; });
    if (m) expertName = m.name;

    // Filter
    var filtered = centers.filter(function(c) {
      if (_wpState.filter === 'p1') return c.potential === 1;
      if (_wpState.filter === 'p2') return c.potential === 2;
      if (_wpState.filter === 'overdue') return c.isOverdue;
      if (_wpState.filter === 'priority') return c.potential <= 2 || c.isOverdue;
      return true;
    });

    var potColor = function(p) { return ['','#10b981','#6366f1','#f59e0b','#94a3b8'][p]||'#94a3b8'; };

    var filterBtns = [
      ['priority', '⭐ اولویت (P1+P2+معوق)'],
      ['p1', 'P1 فقط'],
      ['p2', 'P2 فقط'],
      ['overdue', '🔴 معوق فقط'],
      ['all', 'همه'],
    ].map(function(f) {
      return '<button onclick="window._wpSetFilter(\'' + f[0] + '\')" style="padding:5px 12px;border:1px solid ' + (_wpState.filter===f[0]?'#6366f1':'#e2e8f0') + ';border-radius:20px;font-family:inherit;font-size:.78rem;cursor:pointer;background:' + (_wpState.filter===f[0]?'#6366f1':'#fff') + ';color:' + (_wpState.filter===f[0]?'#fff':'#374151') + '">' + f[1] + '</button>';
    }).join('');

    var tableRows = filtered.map(function(c) {
      var checked = !!_wpState.selected[c.rkey];
      var dayOverride = typeof _wpState.selected[c.rkey] === 'string' ? _wpState.selected[c.rkey] : '';
      var overdueBadge = c.isOverdue ? '<span style="font-size:.7rem;padding:2px 6px;background:#fef2f2;color:#dc2626;border-radius:10px;margin-right:4px">معوق</span>' : '';
      var daysSinceStr = c.daysSince !== null ? c.daysSince + ' روز پیش' : '—';
      var scheduled = c.alreadyScheduled ? '<span style="font-size:.7rem;padding:2px 6px;background:#f0fdf4;color:#16a34a;border-radius:10px">✓ برنامه دارد</span>' : '';

      var dayOpts = '<option value="">پخش خودکار</option>' +
        workDays.map(function(d) {
          return '<option value="' + d + '"' + (dayOverride===d?' selected':'') + '>' + _dayLabel(d) + '</option>';
        }).join('');

      return '<tr style="border-bottom:1px solid #f1f5f9' + (c.isOverdue?';background:#fff5f5':'') + (c.alreadyScheduled?';opacity:.55':'') + '">' +
        '<td style="padding:8px 10px;width:36px">' +
          '<input type="checkbox" ' + (checked?'checked':'') + ' ' + (c.alreadyScheduled?'disabled title="این هفته برنامه دارد"':'') +
            ' onchange="window._wpToggle(\'' + esc(c.rkey) + '\',this.checked)" style="width:16px;height:16px;cursor:pointer">' +
        '</td>' +
        '<td style="padding:8px 10px">' +
          '<div style="font-weight:600;font-size:.88rem">' + esc(c.name) + '</div>' +
          '<div style="font-size:.75rem;color:#6b7280;margin-top:2px">' + esc(c.status) + '</div>' +
        '</td>' +
        '<td style="padding:8px 10px;white-space:nowrap">' +
          '<span style="display:inline-flex;align-items:center;gap:3px;font-size:.8rem;font-weight:700;color:' + potColor(c.potential) + '">P' + c.potential + '</span>' +
        '</td>' +
        '<td style="padding:8px 10px;font-size:.78rem;color:#6b7280;white-space:nowrap">' +
          overdueBadge + (c.followupDate ? c.followupDate : daysSinceStr) +
        '</td>' +
        '<td style="padding:8px 10px">' + (scheduled||'') + '</td>' +
        '<td style="padding:8px 10px;width:160px">' +
          '<select onchange="window._wpSetDay(\'' + esc(c.rkey) + '\',this.value)" style="width:100%;padding:5px 8px;border:1px solid #e2e8f0;border-radius:6px;font-family:inherit;font-size:.78rem">' +
            dayOpts +
          '</select>' +
        '</td>' +
      '</tr>';
    }).join('');

    var selectedKeys = Object.keys(_wpState.selected).filter(function(k){ return _wpState.selected[k] !== false && _wpState.selected[k] !== undefined; });
    var selectedCount = selectedKeys.length;

    // Preview spread
    var previewHtml = '';
    if (selectedCount > 0) {
      var withDay = selectedKeys.filter(function(k){ return _wpState.selected[k]; });
      var withoutDay = selectedKeys.filter(function(k){ return !_wpState.selected[k]; });
      var autoSpread = _autoSpread(withoutDay, workDays);
      var dayBuckets = {};
      workDays.forEach(function(d){ dayBuckets[d] = []; });
      withDay.forEach(function(k){ var d = _wpState.selected[k]; if (!dayBuckets[d]) dayBuckets[d]=[]; dayBuckets[d].push(k); });
      withoutDay.forEach(function(k){ var d = autoSpread[k]; if (!dayBuckets[d]) dayBuckets[d]=[]; dayBuckets[d].push(k); });

      previewHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">' +
        workDays.map(function(d) {
          var items = dayBuckets[d] || [];
          return '<div style="flex:1;min-width:90px;background:#f8fafc;border-radius:8px;padding:8px 10px;border:1px solid #e2e8f0">' +
            '<div style="font-size:.75rem;font-weight:700;color:#374151;margin-bottom:4px">' + _dayLabel(d) + '</div>' +
            '<div style="font-size:1.1rem;font-weight:700;color:' + (items.length>4?'#ef4444':items.length>0?'#6366f1':'#d1d5db') + '">' + items.length + ' مرکز</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    el.innerHTML =
      '<div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">' +

        // Toolbar
        '<div style="padding:14px 18px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<span style="font-size:.85rem;font-weight:600;color:#374151">' + esc(expertName) + ' — ' + range.start + ' تا ' + range.end + ' (' + workDays.length + ' روز کاری)</span>' +
            '<span style="font-size:.8rem;color:#6b7280">' + filtered.length + ' مرکز</span>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' + filterBtns + '</div>' +
        '</div>' +

        // Select all
        '<div style="padding:10px 18px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:12px;background:#f8fafc">' +
          '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.83rem">' +
            '<input type="checkbox" id="wpSelectAll" onchange="window._wpSelectAll(this.checked)" style="width:15px;height:15px"> انتخاب همه' +
          '</label>' +
          '<span style="font-size:.83rem;color:#6366f1;font-weight:600">' + selectedCount + ' مرکز انتخاب شده</span>' +
          (selectedCount > 0
            ? '<button onclick="window._wpClearAll()" style="padding:3px 10px;border:1px solid #e2e8f0;border-radius:6px;font-family:inherit;font-size:.78rem;cursor:pointer;background:#fff">پاک کردن</button>'
            : '') +
        '</div>' +

        // Table
        '<div style="max-height:450px;overflow-y:auto">' +
          '<table style="width:100%;border-collapse:collapse">' +
            '<thead style="position:sticky;top:0;z-index:1"><tr style="background:#f8fafc">' +
              '<th style="padding:8px 10px;width:36px"></th>' +
              '<th style="padding:8px 10px;text-align:right;font-size:.78rem;font-weight:600">مرکز</th>' +
              '<th style="padding:8px 10px;text-align:right;font-size:.78rem;font-weight:600">اهمیت</th>' +
              '<th style="padding:8px 10px;text-align:right;font-size:.78rem;font-weight:600">پیگیری</th>' +
              '<th style="padding:8px 10px;text-align:right;font-size:.78rem;font-weight:600">وضعیت</th>' +
              '<th style="padding:8px 10px;text-align:right;font-size:.78rem;font-weight:600">روز (اختیاری)</th>' +
            '</tr></thead>' +
            '<tbody>' + (tableRows || '<tr><td colspan="6" style="padding:30px;text-align:center;color:#9ca3af">مرکزی یافت نشد</td></tr>') + '</tbody>' +
          '</table>' +
        '</div>' +

        // Preview + Submit
        (selectedCount > 0
          ? '<div style="padding:16px 18px;border-top:1px solid #f1f5f9;background:#f8fafc">' +
              '<div style="font-size:.83rem;font-weight:600;color:#374151;margin-bottom:8px">پیش‌نمایش توزیع:</div>' +
              previewHtml +
              '<div style="margin-top:14px;display:flex;gap:10px;align-items:center">' +
                '<button onclick="window._wpSubmit()" style="padding:10px 28px;background:#10b981;color:white;border:none;border-radius:8px;font-family:inherit;font-size:.95rem;cursor:pointer;font-weight:700">✅ افزودن ' + selectedCount + ' مرکز به برنامه</button>' +
                '<span style="font-size:.8rem;color:#6b7280">برای هفته ' + range.start + ' — ' + esc(expertName) + '</span>' +
              '</div>' +
            '</div>'
          : '') +

      '</div>';
  }

  window._wpSetFilter = function(f) {
    _wpState.filter = f;
    var range = _computeRange();
    _wpRenderList(range);
  };

  window._wpToggle = function(rkey, checked) {
    if (checked) {
      _wpState.selected[rkey] = _wpState.selected[rkey] || '';
    } else {
      delete _wpState.selected[rkey];
    }
    // Re-render just the preview/submit area without full re-render
    var range = _computeRange();
    _wpRenderList(range);
  };

  window._wpSetDay = function(rkey, day) {
    if (_wpState.selected[rkey] !== undefined) {
      _wpState.selected[rkey] = day;
    }
    // update preview
    var range = _computeRange();
    _wpRenderList(range);
  };

  window._wpSelectAll = function(checked) {
    var centers = _wpState.centers.filter(function(c) {
      if (_wpState.filter === 'p1') return c.potential === 1;
      if (_wpState.filter === 'p2') return c.potential === 2;
      if (_wpState.filter === 'overdue') return c.isOverdue;
      if (_wpState.filter === 'priority') return c.potential <= 2 || c.isOverdue;
      return true;
    });
    if (checked) {
      centers.forEach(function(c) {
        if (!c.alreadyScheduled) _wpState.selected[c.rkey] = _wpState.selected[c.rkey] || '';
      });
    } else {
      _wpState.selected = {};
    }
    var range = _computeRange();
    _wpRenderList(range);
  };

  window._wpClearAll = function() {
    _wpState.selected = {};
    var range = _computeRange();
    _wpRenderList(range);
  };

  window._wpSubmit = function() {
    var range = _computeRange();
    if (!range.start || !range.end) { if (typeof showToast==='function') showToast('بازه زمانی مشخص نیست'); return; }

    var selectedKeys = Object.keys(_wpState.selected);
    if (!selectedKeys.length) { if (typeof showToast==='function') showToast('مرکزی انتخاب نشده'); return; }

    var workDays = _workDays(range.start, range.end);
    var withDay    = selectedKeys.filter(function(k){ return _wpState.selected[k]; });
    var withoutDay = selectedKeys.filter(function(k){ return !_wpState.selected[k]; });
    var autoSpread = _autoSpread(withoutDay, workDays);

    // weekId for this range — use start date
    var weekId = _wpState.weekId || range.start;
    var actionType = _wpState.actionType || 'call';
    var expertId = _wpState.expertId;

    var entries = [];
    selectedKeys.forEach(function(rkey) {
      var c = _wpState.centers.find(function(x){ return x.rkey === rkey; });
      if (!c) return;
      var scheduledDate = _wpState.selected[rkey] || autoSpread[rkey] || workDays[0] || '';
      entries.push({
        id: 'we_' + Date.now() + '_' + Math.random().toString(36).slice(2,5) + '_' + c.id.slice(-4),
        weekId: weekId,
        recKey: c.rtype + '_' + c.id,
        rtype: c.rtype,
        rid: c.id,
        scheduledDate: scheduledDate,
        actionType: actionType,
        addedBy: expertId,
        centerName: c.name,
      });
    });

    // POST one by one (batch would be better but API doesn't have bulk insert)
    var btn = document.querySelector('[onclick="window._wpSubmit()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'در حال افزودن...'; }

    var done = 0;
    var errors = 0;
    function postNext(i) {
      if (i >= entries.length) {
        if (typeof showToast === 'function') showToast('✅ ' + done + ' مرکز به برنامه اضافه شد' + (errors > 0 ? ' (' + errors + ' خطا)' : ''));
        _wpState.selected = {};
        // Reload DB to reflect new entries
        if (typeof loadDB === 'function') loadDB().then(function(){ window._wpLoadCenters(); });
        else window._wpLoadCenters();
        return;
      }
      var entry = entries[i];
      fetch('/api/week-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      }).then(function(r) {
        if (r.ok) done++; else errors++;
        postNext(i + 1);
      }).catch(function() {
        errors++;
        postNext(i + 1);
      });
    }
    postNext(0);
  };

})();
