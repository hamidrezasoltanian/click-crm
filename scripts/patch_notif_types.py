#!/usr/bin/env python3
"""
Patch app.bundle.js to:
1. Update sendNotif() to accept type + meta params and send them to API
2. Add _notifAction(nid, action) dispatcher function
3. Update _renderNotifPanel to show type-specific action buttons
4. Update all sendNotif call sites to pass appropriate type
"""

with open('public/js/app.bundle.js', 'r', encoding='utf-8') as f:
    content = f.read()

changes = 0

# ─── 1. Update sendNotif signature to accept type + meta ─────────────────────
OLD_SEND = '''function sendNotif(toUser, message, centerKey, centerKeys) {
  var id = Date.now() + '_' + Math.random().toString(36).slice(2);
  var payload = { id: id, to: toUser, msg: message, centerKey: centerKey || null };
  if (centerKeys && centerKeys.length) payload.centerKeys = centerKeys;
  fetch('/api/notifications', {'''

NEW_SEND = '''function sendNotif(toUser, message, centerKey, centerKeys, type, meta) {
  var id = Date.now() + '_' + Math.random().toString(36).slice(2);
  var payload = { id: id, to: toUser, msg: message, centerKey: centerKey || null,
                  type: type || 'general', meta: meta || null };
  if (centerKeys && centerKeys.length) payload.centerKeys = centerKeys;
  fetch('/api/notifications', {'''

if OLD_SEND in content:
    content = content.replace(OLD_SEND, NEW_SEND, 1)
    print('✅ 1. sendNotif signature updated')
    changes += 1
else:
    print('❌ 1. sendNotif not found')

# Also fix the fallback blob branch to include type/meta
OLD_BLOB_FB = '''    var n = { id: id, to: toUser, from: currentUser, at: new Date().toISOString(),
              message: message, msg: message, centerKey: centerKey || '',
              centerKeys: centerKeys || null, read: false };'''
NEW_BLOB_FB = '''    var n = { id: id, to: toUser, from: currentUser, at: new Date().toISOString(),
              message: message, msg: message, centerKey: centerKey || '',
              centerKeys: centerKeys || null, read: false, type: type || 'general', meta: meta || null };'''
if OLD_BLOB_FB in content:
    content = content.replace(OLD_BLOB_FB, NEW_BLOB_FB, 1)
    print('✅ 1b. sendNotif blob fallback updated')
    changes += 1
else:
    print('❌ 1b. blob fallback not found')

# ─── 2. Add _notifAction function after _timeAgo ─────────────────────────────
OLD_AFTER_TIMAGO = '\nfunction openDailyMonitor(){'
INSERT_BEFORE_DAILY = '''
function _notifAction(nid, action) {
  var n = _notifCache.find(function(x) { return x.id === nid; });
  if (!n) return;
  markNotifRead(nid);
  var p = document.getElementById('notifPanel'); if (p) { p.remove(); _notifPanelOpen = false; }
  var ck = n.centerKey || '';
  var parts = ck.indexOf('_') > 0 ? ck.split('_') : [];
  var rtype = parts[0] || 'center';
  var rid = parts.slice(1).join('_');
  var centerName = ck ? (_clGetName(ck) || ck) : '';
  if (action === 'call') {
    if (rid) setTimeout(function() { quickCallLog(rtype, rid, centerName); }, 100);
    else showToast('مرکز مشخص نیست');
  } else if (action === 'brief') {
    if (rid) setTimeout(function() { openPreCallBrief(rtype, rid); }, 100);
    else showToast('مرکز مشخص نیست');
  } else if (action === 'task') {
    var tid = n.meta && n.meta.taskId;
    if (tid) setTimeout(function() { openTaskModal(tid); }, 100);
    else { switchTab('tasks'); }
  } else if (action === 'weekplan') {
    switchTab('weekplan');
  } else if (action === 'center') {
    if (rid) setTimeout(function() { openCenterModal(rtype, rid); }, 100);
  }
}
'''

if OLD_AFTER_TIMAGO in content:
    content = content.replace(OLD_AFTER_TIMAGO, INSERT_BEFORE_DAILY + OLD_AFTER_TIMAGO, 1)
    print('✅ 2. _notifAction added')
    changes += 1
else:
    print('❌ 2. Could not find openDailyMonitor to insert before')

# ─── 3. Update _renderNotifPanel action buttons to be type-aware ──────────────
OLD_ACTIONS = '''        + (viewAll
          ? (n.ack ? '<span class="notif-ack-badge">✓ تأیید شده</span>' : '')
          : (n.ack
            ? '<span class="notif-ack-badge">✓ تأیید شده</span>'
            : '<button class="notif-act-btn notif-ack-btn" onclick="ackNotif(\\'' + nid + '\\')">✓ انجام دادم</button>'))'''

NEW_ACTIONS = """        + (viewAll
          ? (n.ack ? '<span class="notif-ack-badge">✓ تأیید شده</span>' : '')
          : (n.ack ? '<span class="notif-ack-badge">✓ تأیید شده</span>' : (function(){
              var ntype = n.type || 'general';
              if (ntype === 'followup' || ntype === 'manager_request') {
                return (n.centerKey && n.centerKey.indexOf('_') > 0
                  ? '<button class="notif-act-btn" onclick="_notifAction(\\'' + nid + '\\',\\'call\\')">📞 ثبت تماس</button>'
                    + '<button class="notif-act-btn" onclick="_notifAction(\\'' + nid + '\\',\\'brief\\')">📋 خلاصه</button>'
                  : '<button class="notif-act-btn notif-ack-btn" onclick="ackNotif(\\'' + nid + '\\')">✓ انجام دادم</button>');
              } else if (ntype === 'task') {
                return '<button class="notif-act-btn" onclick="_notifAction(\\'' + nid + '\\',\\'task\\')">📋 باز کردن تکلیف</button>';
              } else if (ntype === 'morning_brief') {
                return '<button class="notif-act-btn" onclick="_notifAction(\\'' + nid + '\\',\\'weekplan\\')">📅 برنامه هفته</button>';
              } else if (ntype === 'owner_change') {
                return '<button class="notif-act-btn" onclick="_notifAction(\\'' + nid + '\\',\\'center\\')">🔍 مشاهده مرکز</button>';
              } else if (ntype === 'ack') {
                return '';
              } else {
                return '<button class="notif-act-btn notif-ack-btn" onclick="ackNotif(\\'' + nid + '\\')">✓ انجام دادم</button>';
              }
            })()))"""

if OLD_ACTIONS in content:
    content = content.replace(OLD_ACTIONS, NEW_ACTIONS, 1)
    print('✅ 3. _renderNotifPanel action buttons updated')
    changes += 1
else:
    print('❌ 3. Could not find action buttons block in _renderNotifPanel')

# ─── 4. Update sendNotif call sites ──────────────────────────────────────────

# 4a. Owner change notification (in setE)
OLD_OWNER = "sendNotif(val,'مرکز \"'+_cn+'\" به شما واگذار شد',type+'_'+id);"
NEW_OWNER = "sendNotif(val,'مرکز \"'+_cn+'\" به شما واگذار شد',type+'_'+id,[],\\'owner_change\\',{centerKey:type+\\'_\\'+id});"
# Actually the quotes are tricky here - let's find it properly
OLD_OWNER2 = "sendNotif(val,'\\u0645\\u0631\\u06a9\\u0632 \"'+_cn+'\" \\u0628\\u0647 \\u0634\\u0645\\u0627 \\u0648\\u0627\\u06af\\u0630\\u0627\\u0631 \\u0634\\u062f',type+'_'+id);"

# search for it with encoded version
import re

# Let's find the exact string around line 955
pos_owner = content.find("sendNotif(val,'مرکز \"'+_cn+'\" به شما واگذار شد',type+'_'+id)")
if pos_owner != -1:
    old_str = "sendNotif(val,'مرکز \"'+_cn+'\" به شما واگذار شد',type+'_'+id)"
    new_str = "sendNotif(val,'مرکز \"'+_cn+'\" به شما واگذار شد',type+'_'+id,[],'owner_change',{centerKey:type+'_'+id})"
    content = content.replace(old_str, new_str, 1)
    print('✅ 4a. owner_change sendNotif updated')
    changes += 1
else:
    print('❌ 4a. owner_change sendNotif not found')

# 4b. ackNotif reply (the reply back to sender) - type 'ack'
old_ack = "sendNotif(n.from, replyMsg, n.centerKey || '');"
new_ack = "sendNotif(n.from, replyMsg, n.centerKey || '', [], 'ack', null);"
if old_ack in content:
    content = content.replace(old_ack, new_ack, 1)
    print('✅ 4b. ack sendNotif updated')
    changes += 1
else:
    print('❌ 4b. ack sendNotif not found')

# 4c. Task assignment
old_task = "sendNotif(t.owner,'وظیفه «'+t.title+'» به شما واگذار شد',t.centerKey||'');"
new_task = "sendNotif(t.owner,'وظیفه «'+t.title+'» به شما واگذار شد',t.centerKey||'',[],'task',{taskId:t.id,taskTitle:t.title});"
if old_task in content:
    content = content.replace(old_task, new_task, 1)
    print('✅ 4c. task assignment sendNotif updated')
    changes += 1
else:
    print('❌ 4c. task assignment sendNotif not found')

# 4d. Morning briefing (line ~7502)
old_morning = "    sendNotif(exp, msg, '');\n  });\n  if(cnt>0) showToast('🌅 بریفینگ صبحگاهی"
new_morning = "    sendNotif(exp, msg, '', [], 'morning_brief', null);\n  });\n  if(cnt>0) showToast('🌅 بریفینگ صبحگاهی"
if old_morning in content:
    content = content.replace(old_morning, new_morning, 1)
    print('✅ 4d. morning_brief sendNotif updated')
    changes += 1
else:
    print('❌ 4d. morning_brief sendNotif not found')

# 4e. Today reminders (_runTodayReminders, line ~7528)
old_today = "    sendNotif(exp, msg, items[0].key, items.map(function(x){return x.key;}));"
new_today = "    sendNotif(exp, msg, items[0].key, items.map(function(x){return x.key;}), 'followup', null);"
if old_today in content:
    content = content.replace(old_today, new_today, 1)
    print('✅ 4e. today reminders sendNotif updated')
    changes += 1
else:
    print('❌ 4e. today reminders sendNotif not found')

# 4f. Overdue reminders
old_over = "      sendNotif(exp, msg, d.overdue[0].key, d.overdue.map(function(x){return x.key;}));"
new_over = "      sendNotif(exp, msg, d.overdue[0].key, d.overdue.map(function(x){return x.key;}), 'followup', null);"
if old_over in content:
    content = content.replace(old_over, new_over, 1)
    print('✅ 4f. overdue sendNotif updated')
    changes += 1
else:
    print('❌ 4f. overdue sendNotif not found')

# 4g. No-date reminders
old_nodate = "      sendNotif(exp, msg2, d.noDate[0].key, d.noDate.map(function(x){return x.key;}));"
new_nodate = "      sendNotif(exp, msg2, d.noDate[0].key, d.noDate.map(function(x){return x.key;}), 'followup', null);"
if old_nodate in content:
    content = content.replace(old_nodate, new_nodate, 1)
    print('✅ 4g. no-date sendNotif updated')
    changes += 1
else:
    print('❌ 4g. no-date sendNotif not found')

# 4h. Manager compose panel (manager_request)
old_mgr = "sendNotif('"+"""'+memberId+\"',msg,'');closeModal('rptNotifCompose')"""
new_mgr = "sendNotif('"+"""'+memberId+\"',msg,'',[],'manager_request',null);closeModal('rptNotifCompose')"""
if old_mgr in content:
    content = content.replace(old_mgr, new_mgr, 1)
    print('✅ 4h. manager_request sendNotif updated')
    changes += 1
else:
    # try alternate form
    alt_mgr = "sendNotif(\\''+memberId+\"\\',msg,\\'\\');"
    print(f'❌ 4h. manager_request sendNotif not found (trying alternate...)')
    # Search more carefully
    idx = content.find("closeModal('rptNotifCompose')")
    if idx > 0:
        snippet = content[idx-200:idx+50]
        print(f'   Context: {repr(snippet[-150:])}')

# 4i. _runStartupReminders — simple expert notification (followup)
# Lines ~6620 and ~6665
old_s1 = "    sendNotif(exp,msg,'');\n"
new_s1 = "    sendNotif(exp,msg,'',[],'followup',null);\n"
count_s1 = content.count(old_s1)
if count_s1 > 0:
    content = content.replace(old_s1, new_s1)
    print(f'✅ 4i. startup expert sendNotif updated ({count_s1} occurrences)')
    changes += 1
else:
    print('❌ 4i. startup expert sendNotif not found')

old_s2 = "  sendNotif(expertUser,msg,'');\n"
new_s2 = "  sendNotif(expertUser,msg,'',[],'followup',null);\n"
if old_s2 in content:
    content = content.replace(old_s2, new_s2, 1)
    print('✅ 4j. expertUser sendNotif updated')
    changes += 1
else:
    print('❌ 4j. expertUser sendNotif not found')

with open('public/js/app.bundle.js', 'w', encoding='utf-8') as f:
    f.write(content)

print(f'\nTotal changes: {changes}')
print('Run: node --check public/js/app.bundle.js')
