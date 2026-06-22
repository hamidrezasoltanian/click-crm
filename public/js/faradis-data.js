/* faradis-data.js — Faradis extended data views
   Team sales, inventory compare, follower mapping, center product history */
'use strict';

(function() {

function _fdEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _fdFmt(amt) {
  amt = parseFloat(amt || 0);
  if (amt >= 1e9) return (amt/1e9).toFixed(1) + 'B';
  if (amt >= 1e6) return (amt/1e6).toFixed(0) + 'M';
  return amt.toFixed(0);
}

// ── Sync all ──────────────────────────────────────────────────────────────

window._fdSyncAll = function() {
  var btn = document.getElementById('fdSyncAllBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Sync…'; }
  fetch('/api/faradis-data/sync-all', { method: 'POST' })
    .then(function(r){ return r.json(); })
    .then(function(d) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Sync همه'; }
      if (d.error) { if (typeof showToast === 'function') showToast('❌ ' + d.error, 4000); return; }
      var parts = Object.entries(d).map(function(kv) {
        return kv[1].ok ? kv[0]+':'+kv[1].count : kv[0]+':❌';
      });
      if (typeof showToast === 'function') showToast('✅ ' + parts.join(' | '), 6000);
    })
    .catch(function(e) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 Sync همه'; }
      if (typeof showToast === 'function') showToast('❌ ' + e.message, 4000);
    });
};

// ── Follower mapping tab ──────────────────────────────────────────────────

window.renderFdFollowers = function(containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ بارگذاری…</div>';
  Promise.all([
    fetch('/api/faradis-data/followers').then(function(r){ return r.json(); }),
    fetch('/api/faradis-data/users').then(function(r){ return r.json(); }),
  ]).then(function(res) {
    var followers = res[0];
    var users = Array.isArray(res[1]) ? res[1] : [];
    if (!Array.isArray(followers)) {
      el.innerHTML = '<div style="color:#ef4444;padding:12px">خطا: ' + _fdEsc(followers.error || 'نامعلوم') + '</div>';
      return;
    }
    if (followers.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">'
        + '<div style="font-size:32px;margin-bottom:12px">👥</div>'
        + '<div style="margin-bottom:14px">ابتدا بازاریاب‌های فرادیس را دریافت کنید</div>'
        + '<button id="fdSyncFollBtn" onclick="window._fdSyncFollowers()" style="padding:7px 18px;border-radius:7px;border:none;background:#6366f1;color:#fff;cursor:pointer;font-family:inherit;font-size:13px">🔄 دریافت بازاریاب‌ها</button>'
        + '</div>';
      return;
    }
    var userOpts = '<option value="">— انتخاب کارشناس —</option>'
      + users.map(function(u) {
          return '<option value="' + _fdEsc(u.username) + '">' + _fdEsc(u.name || u.username) + '</option>';
        }).join('');

    var html = '<div style="margin-bottom:14px;display:flex;gap:10px;align-items:center">'
      + '<button id="fdSyncFollBtn" onclick="window._fdSyncFollowers()" style="padding:6px 14px;border-radius:7px;border:none;background:#6366f1;color:#fff;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600">🔄 بروزرسانی</button>'
      + '<span style="font-size:12px;color:var(--text-muted)">' + followers.length + ' بازاریاب در فرادیس | نگاشت کنید هر بازاریاب به کدام کارشناس CRM مربوط است</span>'
      + '</div>'
      + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr style="background:var(--bg-raised)">'
      + '<th style="padding:8px 12px;text-align:right;border-bottom:2px solid var(--border)">شماره</th>'
      + '<th style="padding:8px 12px;text-align:right;border-bottom:2px solid var(--border)">کد</th>'
      + '<th style="padding:8px 12px;text-align:right;border-bottom:2px solid var(--border)">نام بازاریاب</th>'
      + '<th style="padding:8px 12px;text-align:right;border-bottom:2px solid var(--border)">کارشناس CRM</th>'
      + '<th style="padding:8px 12px;border-bottom:2px solid var(--border)"></th>'
      + '</tr></thead><tbody>';
    followers.forEach(function(f) {
      html += '<tr style="border-bottom:1px solid var(--border)">'
        + '<td style="padding:8px 12px;font-family:monospace;font-size:11px;color:var(--text-muted)">' + f.follower_num + '</td>'
        + '<td style="padding:8px 12px;font-size:11px">' + _fdEsc(f.follower_code) + '</td>'
        + '<td style="padding:8px 12px;font-weight:600">' + _fdEsc(f.follower_name) + '</td>'
        + '<td style="padding:8px 12px"><select id="fdMap_' + f.follower_num + '" style="padding:5px 8px;border:1px solid var(--border-input);border-radius:5px;font-family:inherit;font-size:12px;background:var(--bg-input);color:var(--text-primary)">'
        + userOpts + '</select></td>'
        + '<td style="padding:8px 12px"><button onclick="window._fdSaveMap(' + f.follower_num + ')" style="padding:4px 14px;border-radius:5px;border:none;background:#6366f1;color:#fff;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">ذخیره</button></td>'
        + '</tr>';
    });
    html += '</tbody></table></div>';
    el.innerHTML = html;
    followers.forEach(function(f) {
      if (f.crm_username) {
        var sel = document.getElementById('fdMap_' + f.follower_num);
        if (sel) sel.value = f.crm_username;
      }
    });
  }).catch(function(e) {
    if (el) el.innerHTML = '<div style="color:#ef4444;padding:12px">خطا: ' + _fdEsc(e.message) + '</div>';
  });
};

window._fdSyncFollowers = function() {
  var btn = document.getElementById('fdSyncFollBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
  fetch('/api/faradis-data/sync-followers', { method: 'POST' })
    .then(function(r){ return r.json(); })
    .then(function(d) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 بروزرسانی'; }
      if (d.error) { if (typeof showToast === 'function') showToast('❌ ' + d.error, 4000); return; }
      if (typeof showToast === 'function') showToast('✅ ' + d.count + ' بازاریاب دریافت شد');
      window.renderFdFollowers('fdFollowersContainer');
    })
    .catch(function(e) {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 بروزرسانی'; }
      if (typeof showToast === 'function') showToast('❌ ' + e.message, 4000);
    });
};

window._fdSaveMap = function(followerNum) {
  var sel = document.getElementById('fdMap_' + followerNum);
  var username = sel ? sel.value : '';
  fetch('/api/faradis-data/follower-map', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ follower_num: followerNum, crm_username: username }),
  }).then(function(r){ return r.json(); })
    .then(function(d) {
      if (d.error) { if (typeof showToast === 'function') showToast('❌ ' + d.error, 3000); return; }
      if (typeof showToast === 'function') showToast(username ? '✅ نگاشت ذخیره شد' : '🗑 نگاشت حذف شد');
    })
    .catch(function(e) { if (typeof showToast === 'function') showToast('❌ ' + e.message, 3000); });
};

// ── Team sales tab ────────────────────────────────────────────────────────

window.renderFdTeamSales = function(containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ بارگذاری…</div>';
  fetch('/api/faradis-data/team-sales')
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (!Array.isArray(data)) {
        el.innerHTML = '<div style="color:#ef4444;padding:12px">خطا: ' + _fdEsc(data.error || 'نامعلوم') + '</div>';
        return;
      }
      if (data.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">'
          + '<div style="font-size:32px;margin-bottom:12px">📊</div>'
          + '<div>ابتدا بازاریاب‌ها را نگاشت کنید (تب 🗺 نگاشت) و فاکتورها را sync کنید</div>'
          + '</div>';
        return;
      }
      var byMonth = {};
      var users = new Set();
      data.forEach(function(r) {
        if (!byMonth[r.jalali_month]) byMonth[r.jalali_month] = {};
        byMonth[r.jalali_month][r.crm_username] = r;
        users.add(r.crm_username);
      });
      var months = Object.keys(byMonth).sort().reverse().slice(0, 6);
      var userArr = Array.from(users).sort();

      var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:500px">'
        + '<thead><tr style="background:var(--bg-raised)">'
        + '<th style="padding:9px 14px;text-align:right;border-bottom:2px solid var(--border)">کارشناس</th>';
      months.forEach(function(m) {
        html += '<th style="padding:9px 14px;text-align:center;border-bottom:2px solid var(--border)">' + m + '</th>';
      });
      html += '</tr></thead><tbody>';
      userArr.forEach(function(u) {
        html += '<tr style="border-bottom:1px solid var(--border)">'
          + '<td style="padding:8px 14px;font-weight:600">' + _fdEsc(u) + '</td>';
        months.forEach(function(m) {
          var row = byMonth[m] && byMonth[m][u];
          if (row) {
            html += '<td style="padding:8px 14px;text-align:center">'
              + '<div style="font-weight:700;color:var(--text-primary)">' + _fdFmt(row.total_amount) + '</div>'
              + '<div style="font-size:10px;color:var(--text-muted)">' + row.invoice_count + ' فاکتور | ' + row.customer_count + ' مرکز</div>'
              + '</td>';
          } else {
            html += '<td style="padding:8px 14px;text-align:center;color:var(--text-muted)">—</td>';
          }
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      el.innerHTML = html;
    })
    .catch(function(e) {
      if (el) el.innerHTML = '<div style="color:#ef4444;padding:12px">خطا: ' + _fdEsc(e.message) + '</div>';
    });
};

// ── Inventory compare tab ─────────────────────────────────────────────────

window.renderFdInventory = function(containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">⏳ بارگذاری…</div>';
  fetch('/api/faradis-data/inventory-compare')
    .then(function(r){ return r.json(); })
    .then(function(data) {
      if (!Array.isArray(data)) {
        el.innerHTML = '<div style="color:#ef4444;padding:12px">خطا: ' + _fdEsc(data.error || 'نامعلوم') + '</div>';
        return;
      }
      if (data.length === 0) {
        el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">موجودی فرادیس sync نشده — دکمه Sync موجودی را بزنید</div>';
        return;
      }
      var mismatches = data.filter(function(r){ return r.matched && Math.abs(r.diff) >= 0.01; }).length;
      var unmatched = data.filter(function(r){ return !r.matched; }).length;
      var html = '<div style="margin-bottom:10px;display:flex;gap:16px;font-size:12px;flex-wrap:wrap">'
        + '<span>' + data.length + ' محصول فرادیس</span>'
        + '<span style="color:#16a34a">✅ ' + (data.length - mismatches - unmatched) + ' تطابق</span>'
        + '<span style="color:#dc2626">⚠ ' + mismatches + ' مغایرت</span>'
        + '<span style="color:var(--text-muted)">— ' + unmatched + ' فقط در فرادیس</span>'
        + '</div>'
        + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
        + '<thead><tr style="background:var(--bg-raised)">'
        + '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border)">محصول</th>'
        + '<th style="padding:8px 10px;text-align:right;border-bottom:2px solid var(--border)">کد</th>'
        + '<th style="padding:8px 10px;text-align:center;border-bottom:2px solid var(--border)">فرادیس</th>'
        + '<th style="padding:8px 10px;text-align:center;border-bottom:2px solid var(--border)">WMS</th>'
        + '<th style="padding:8px 10px;text-align:center;border-bottom:2px solid var(--border)">مغایرت</th>'
        + '</tr></thead><tbody>';
      data.forEach(function(r) {
        var bg = !r.matched ? '' : (Math.abs(r.diff) < 0.01 ? '#f0fdf4' : '#fef2f2');
        var diffCol = r.diff === null ? 'var(--text-muted)' : (Math.abs(r.diff) < 0.01 ? '#16a34a' : '#dc2626');
        var fmtQty = function(q) { return q % 1 === 0 ? q : q.toFixed(2); };
        html += '<tr style="border-bottom:1px solid var(--border);background:' + bg + '">'
          + '<td style="padding:7px 10px;font-weight:600">' + _fdEsc(r.stuff_name) + '</td>'
          + '<td style="padding:7px 10px;font-family:monospace;font-size:11px;color:var(--text-muted)">' + _fdEsc(r.stuff_code) + '</td>'
          + '<td style="padding:7px 10px;text-align:center">' + fmtQty(r.faradis_qty) + '</td>'
          + '<td style="padding:7px 10px;text-align:center">' + (r.wms_qty !== null ? fmtQty(r.wms_qty) : '<span style="color:var(--text-muted)">—</span>') + '</td>'
          + '<td style="padding:7px 10px;text-align:center;font-weight:700;color:' + diffCol + '">'
          + (r.diff !== null ? (r.diff > 0 ? '+' : '') + fmtQty(r.diff) : '—') + '</td>'
          + '</tr>';
      });
      html += '</tbody></table></div>';
      el.innerHTML = html;
    })
    .catch(function(e) {
      if (el) el.innerHTML = '<div style="color:#ef4444;padding:12px">خطا: ' + _fdEsc(e.message) + '</div>';
    });
};

// ── Center product history ────────────────────────────────────────────────

window._fdShowCenterProducts = function(crmKey, btn) {
  var detail = btn.nextElementSibling;
  if (!detail) return;
  if (detail.style.display !== 'none') {
    detail.style.display = 'none';
    btn.textContent = '📦 محصولات';
    return;
  }
  btn.textContent = '⏳';
  detail.style.display = '';
  detail.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:6px">بارگذاری…</div>';
  fetch('/api/faradis-data/center-products/' + encodeURIComponent(crmKey))
    .then(function(r){ return r.json(); })
    .then(function(d) {
      btn.textContent = '📦 محصولات';
      if (!d.linked) {
        detail.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:6px">لینک به فرادیس وجود ندارد</div>';
        return;
      }
      if (!d.products || d.products.length === 0) {
        detail.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:6px">محصولی ثبت نشده (ابتدا ریز فاکتورها را sync کنید)</div>';
        return;
      }
      var html = '<table style="width:100%;border-collapse:collapse;font-size:11px;margin-top:6px">'
        + '<thead><tr style="background:var(--bg-raised)">'
        + '<th style="padding:4px 8px;text-align:right;border-bottom:1px solid var(--border)">محصول</th>'
        + '<th style="padding:4px 8px;text-align:center;border-bottom:1px solid var(--border)">فاکتور</th>'
        + '<th style="padding:4px 8px;text-align:center;border-bottom:1px solid var(--border)">مبلغ</th>'
        + '<th style="padding:4px 8px;text-align:center;border-bottom:1px solid var(--border)">آخرین خرید</th>'
        + '</tr></thead><tbody>';
      d.products.forEach(function(p) {
        html += '<tr style="border-bottom:1px solid var(--border)">'
          + '<td style="padding:4px 8px">' + _fdEsc(p.stuff_name || '—') + '</td>'
          + '<td style="padding:4px 8px;text-align:center">' + p.invoice_count + '</td>'
          + '<td style="padding:4px 8px;text-align:center;font-weight:600">' + _fdFmt(p.total_amount) + '</td>'
          + '<td style="padding:4px 8px;text-align:center;font-size:10px;color:var(--text-muted)">' + _fdEsc(p.last_purchase || '') + '</td>'
          + '</tr>';
      });
      html += '</tbody></table>';
      detail.innerHTML = html;
    })
    .catch(function(e) {
      btn.textContent = '📦 محصولات';
      detail.innerHTML = '<div style="color:#ef4444;font-size:11px;padding:4px">خطا: ' + _fdEsc(e.message) + '</div>';
    });
};

// ── Center contact enrichment ─────────────────────────────────────────────

window._fdShowEnrichment = function(crmKey, btn) {
  var detail = btn.nextElementSibling;
  if (!detail) return;
  if (detail.style.display !== 'none') {
    detail.style.display = 'none';
    btn.textContent = '📋 تماس';
    return;
  }
  btn.textContent = '⏳';
  detail.style.display = '';
  fetch('/api/faradis-data/center-enrichment/' + encodeURIComponent(crmKey))
    .then(function(r){ return r.json(); })
    .then(function(d) {
      btn.textContent = '📋 تماس';
      if (!d.linked) {
        detail.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px">لینک ندارد</div>';
        return;
      }
      var lines = [
        d.phone ? 'تلفن: <b>' + _fdEsc(d.phone) + '</b>' : '',
        d.mobile ? 'موبایل: <b>' + _fdEsc(d.mobile) + '</b>' : '',
        (d.city || d.state) ? 'شهر: <b>' + _fdEsc([d.city, d.state].filter(Boolean).join(' / ')) + '</b>' : '',
        d.address ? 'آدرس: ' + _fdEsc(d.address.slice(0, 100)) : '',
      ].filter(Boolean);
      detail.innerHTML = '<div style="font-size:11px;color:var(--text-secondary);padding:4px 6px;line-height:2">'
        + (lines.length ? lines.join('<br>') : 'اطلاعات تماسی ثبت نشده') + '</div>';
    })
    .catch(function(e) {
      btn.textContent = '📋 تماس';
      detail.innerHTML = '<div style="color:#ef4444;font-size:11px;padding:4px">خطا</div>';
    });
};

})();
