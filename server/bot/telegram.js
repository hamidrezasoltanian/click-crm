'use strict';

// ════════════════════════════════════════════════════════════════
// TELEGRAM BOT — آتنا زیست درمان
// Features: proforma approval, inventory check, QR product scan
// Auth: /start → username → password (verified against CRM DB)
// Polling mode (no webhook needed)
// ════════════════════════════════════════════════════════════════

const https  = require('https');
const crypto = require('crypto');
const Jimp   = require('jimp');
const jsQR   = require('jsqr');
const bcrypt = require('bcryptjs');
const { query } = require('../db');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API   = 'https://api.telegram.org/bot' + TOKEN;

// ── In-memory sessions: chatId → { username, role, state, pendingUser } ──
const sessions = {};

// ── Conversation states ───────────────────────────────────────────────────
const ST = {
  IDLE:           'idle',
  AWAIT_USERNAME: 'await_username',
  AWAIT_PASSWORD: 'await_password',
  AWAIT_REJECT:   'await_reject',  // pendingPfId set
};

// ── Telegram API helpers ──────────────────────────────────────────────────
function tgCall(method, body) {
  return new Promise(function(resolve, reject) {
    const data = JSON.stringify(body || {});
    const opts = {
      hostname: 'api.telegram.org',
      path:     '/bot' + TOKEN + '/' + method,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(opts, function(res) {
      let buf = '';
      res.on('data', function(c){ buf += c; });
      res.on('end', function(){ try { resolve(JSON.parse(buf)); } catch(e){ resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMsg(chatId, text, opts) {
  return tgCall('sendMessage', Object.assign({ chat_id: chatId, text: text, parse_mode: 'HTML' }, opts || {}));
}

function editMsg(chatId, msgId, text, opts) {
  return tgCall('editMessageText', Object.assign({ chat_id: chatId, message_id: msgId, text: text, parse_mode: 'HTML' }, opts || {}));
}

function answerCallback(cbId, text) {
  return tgCall('answerCallbackQuery', { callback_query_id: cbId, text: text || '' });
}

// Download file from Telegram CDN and return Buffer
function downloadFile(fileId) {
  return tgCall('getFile', { file_id: fileId }).then(function(r) {
    if (!r.ok) throw new Error('getFile failed');
    const filePath = r.result.file_path;
    return new Promise(function(resolve, reject) {
      https.get('https://api.telegram.org/file/bot' + TOKEN + '/' + filePath, function(res) {
        const chunks = [];
        res.on('data', function(c){ chunks.push(c); });
        res.on('end', function(){ resolve(Buffer.concat(chunks)); });
      }).on('error', reject);
    });
  });
}

// ── Data helpers ──────────────────────────────────────────────────────────
async function loadProformas() {
  const r = await query(`SELECT value FROM app_data WHERE key = 'proformas'`);
  return r.rows.length ? r.rows[0].value : [];
}

async function saveProformas(list, username) {
  await query(
    `INSERT INTO app_data (key, value, updated_at, updated_by)
     VALUES ('proformas', $1, NOW(), $2)
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW(), updated_by=$2`,
    [JSON.stringify(list), username]
  );
}

async function loadWMS() {
  const r = await query(`SELECT value FROM app_data WHERE key = 'wms'`);
  return r.rows.length ? r.rows[0].value : null;
}

async function loadBotSessions() {
  const r = await query(`SELECT value FROM app_data WHERE key = 'bot_sessions'`);
  return r.rows.length ? r.rows[0].value : {};
}

async function saveBotSessions(map) {
  await query(
    `INSERT INTO app_data (key, value, updated_at, updated_by)
     VALUES ('bot_sessions', $1, NOW(), 'bot')
     ON CONFLICT (key) DO UPDATE SET value=$1, updated_at=NOW(), updated_by='bot'`,
    [JSON.stringify(map)]
  );
}

// Verify CRM credentials — returns user row or null
async function verifyCRM(username, password) {
  try {
    const r = await query(
      'SELECT username, display_name, role, password_hash FROM app_users WHERE username = $1 AND active = true',
      [username]
    );
    if (!r.rows.length) return null;
    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    return ok ? u : null;
  } catch(e) { return null; }
}

// ── Persian number formatter ──────────────────────────────────────────────
function fmtN(n) { return Number(n||0).toLocaleString('fa-IR'); }

// ── Status labels ─────────────────────────────────────────────────────────
const PF_LABELS = { draft:'پیش‌نویس', sent:'ارسال شده', approved:'✅ تأیید', rejected:'❌ رد', cancelled:'لغو' };

// ── Main menu keyboard ────────────────────────────────────────────────────
const MENU_KB = {
  keyboard: [
    [{ text: '📄 پیشفاکتورها' }, { text: '📦 موجودی انبار' }],
    [{ text: '🔍 اسکن QR کالا' }, { text: '❓ راهنما' }],
  ],
  resize_keyboard: true,
};

// ── Update handler ────────────────────────────────────────────────────────
async function handleUpdate(upd) {
  try {
    if (upd.callback_query) {
      await handleCallback(upd.callback_query);
      return;
    }
    const msg = upd.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    const text   = (msg.text || '').trim();

    // Restore session from DB on first contact
    if (!sessions[chatId]) {
      const stored = await loadBotSessions();
      if (stored[chatId]) sessions[chatId] = stored[chatId];
      else sessions[chatId] = { state: ST.AWAIT_USERNAME };
    }

    const sess = sessions[chatId];

    // ── QR photo ──────────────────────────────────────────────────────────
    if (msg.photo && sess.state === ST.IDLE) {
      await handlePhoto(chatId, msg);
      return;
    }

    // ── State machine ─────────────────────────────────────────────────────
    if (sess.state === ST.AWAIT_USERNAME) {
      if (!text) {
        await sendMsg(chatId, '🔐 <b>ورود به سیستم</b>\n\nلطفاً نام کاربری CRM خود را وارد کنید:\n(مثال: <code>Sarah.hosseini</code>)');
        return;
      }
      sess.pendingUser = text;
      sess.state = ST.AWAIT_PASSWORD;
      await sendMsg(chatId, '🔑 رمز عبور خود را وارد کنید:');
      return;
    }

    if (sess.state === ST.AWAIT_PASSWORD) {
      const user = await verifyCRM(sess.pendingUser, text);
      if (!user) {
        sess.state = ST.AWAIT_USERNAME;
        delete sess.pendingUser;
        await sendMsg(chatId, '❌ نام کاربری یا رمز عبور اشتباه است.\n\nدوباره نام کاربری خود را وارد کنید:');
        return;
      }
      sess.username = user.username;
      sess.name     = user.display_name;
      sess.role     = user.role;
      sess.state    = ST.IDLE;
      delete sess.pendingUser;
      await persistSession(chatId);
      const isManager = ['مدیر', 'سوپر ادمین'].includes(user.role);
      await sendMsg(chatId,
        '✅ <b>خوش آمدید، ' + user.display_name + '!</b>\n' +
        'نقش: ' + user.role + (isManager ? ' 👑' : '') + '\n\n' +
        'از منو زیر انتخاب کنید:',
        { reply_markup: MENU_KB }
      );
      return;
    }

    if (sess.state === ST.AWAIT_REJECT) {
      // Manager typed rejection note
      const { pfId } = sess;
      delete sess.pfId;
      sess.state = ST.IDLE;
      await doRejectPf(chatId, pfId, text, sess);
      return;
    }

    // ── Commands ──────────────────────────────────────────────────────────
    if (text === '/start' || text === '/help' || text === '❓ راهنما') {
      if (!sess.username) {
        sess.state = ST.AWAIT_USERNAME;
        await sendMsg(chatId, '🔐 <b>ورود به سیستم</b>\n\nلطفاً نام کاربری CRM خود را وارد کنید:');
      } else {
        await sendMsg(chatId,
          '📋 <b>دستورات موجود:</b>\n\n' +
          '📄 <b>پیشفاکتورها</b> — لیست و تأیید\n' +
          '📦 <b>موجودی انبار</b> — خلاصه موجودی\n' +
          '🔍 <b>اسکن QR کالا</b> — عکس QR بفرستید\n' +
          '/logout — خروج از حساب',
          { reply_markup: MENU_KB }
        );
      }
      return;
    }

    if (!sess.username) {
      await sendMsg(chatId, '🔐 ابتدا وارد شوید. نام کاربری CRM خود را بنویسید:');
      sess.state = ST.AWAIT_USERNAME;
      return;
    }

    if (text === '/logout') {
      delete sessions[chatId];
      await persistSession(chatId, true);
      await sendMsg(chatId, '👋 از سیستم خارج شدید.', { reply_markup: { remove_keyboard: true } });
      return;
    }

    if (text === '📄 پیشفاکتورها' || text === '/proformas') {
      await handleProformas(chatId, sess);
      return;
    }

    if (text === '📦 موجودی انبار' || text === '/inventory') {
      await handleInventory(chatId, sess);
      return;
    }

    if (text === '🔍 اسکن QR کالا' || text === '/scan') {
      await sendMsg(chatId, '📸 عکس QR کد کالا را بفرستید:', { reply_markup: { force_reply: true } });
      return;
    }

    // Default
    await sendMsg(chatId, 'از منو زیر انتخاب کنید:', { reply_markup: MENU_KB });

  } catch(e) {
    console.error('[bot] handleUpdate error:', e.message);
  }
}

// ── Persist session to DB ─────────────────────────────────────────────────
async function persistSession(chatId, remove) {
  try {
    const stored = await loadBotSessions();
    if (remove) delete stored[chatId];
    else stored[chatId] = sessions[chatId];
    await saveBotSessions(stored);
  } catch(e) {}
}

// ── Proformas handler ─────────────────────────────────────────────────────
async function handleProformas(chatId, sess) {
  const isManager = ['مدیر', 'سوپر ادمین'].includes(sess.role);
  const list = await loadProformas();

  // Manager sees all 'sent' proformas; expert sees own
  const visible = isManager
    ? list.filter(function(p){ return p.status === 'sent'; })
    : list.filter(function(p){ return p.createdBy === sess.username && ['draft','sent','approved','rejected'].includes(p.status); });

  if (!visible.length) {
    const msg = isManager
      ? '✅ هیچ پیشفاکتور در انتظار تأییدی وجود ندارد.'
      : '📄 پیشفاکتوری ثبت نشده است.';
    await sendMsg(chatId, msg, { reply_markup: MENU_KB });
    return;
  }

  for (const pf of visible.slice(0, 10)) {
    const itemList = (pf.items || []).slice(0, 3).map(function(i){
      return '  • ' + i.name + ' × ' + i.qty;
    }).join('\n');
    const moreItems = (pf.items || []).length > 3 ? '\n  و ' + ((pf.items||[]).length - 3) + ' ردیف دیگر...' : '';

    let text =
      '📄 <b>' + pf.no + '</b>\n' +
      '👤 مشتری: ' + (pf.centerName || '—') + '\n' +
      '📅 تاریخ: ' + (pf.jalaliDate || '—') + '\n' +
      '💰 مبلغ: <b>' + fmtN(pf.total) + ' ﷼</b>\n' +
      '🔖 وضعیت: ' + (PF_LABELS[pf.status] || pf.status) + '\n' +
      '📦 کالاها:\n' + itemList + moreItems;

    if (pf.note) text += '\n📝 ' + pf.note;

    // Inline keyboard for manager
    let inlineKb = undefined;
    if (isManager && pf.status === 'sent') {
      inlineKb = { inline_keyboard: [[
        { text: '✅ تأیید', callback_data: 'pf_approve:' + pf.id },
        { text: '❌ رد',    callback_data: 'pf_reject:'  + pf.id },
      ]] };
    }
    // Expert can send draft
    if (!isManager && pf.status === 'draft' && pf.createdBy === sess.username) {
      inlineKb = { inline_keyboard: [[
        { text: '📤 ارسال برای تأیید', callback_data: 'pf_send:' + pf.id },
      ]] };
    }

    await sendMsg(chatId, text, inlineKb ? { reply_markup: inlineKb } : undefined);
  }

  if (visible.length > 10) {
    await sendMsg(chatId, '⚠️ ' + visible.length + ' پیشفاکتور موجود است. ۱۰ تای اول نمایش داده شد.', { reply_markup: MENU_KB });
  }
}

// ── Inventory handler ─────────────────────────────────────────────────────
async function handleInventory(chatId, sess) {
  const wms = await loadWMS();
  if (!wms || !wms.products || !wms.lots) {
    await sendMsg(chatId, '⚠️ اطلاعات انبار بارگذاری نشده است.\nابتدا از طریق پنل وب، WMS را راه‌اندازی کنید.', { reply_markup: MENU_KB });
    return;
  }

  // Aggregate stock per product
  const stockMap = {};
  wms.lots.forEach(function(lot) {
    if (!lot.productId) return;
    if (!stockMap[lot.productId]) stockMap[lot.productId] = { qty: 0, expirySoon: false };
    stockMap[lot.productId].qty += (lot.qty || 0);
    // Check if any lot expires within 90 days
    if (lot.expiry) {
      const daysLeft = Math.ceil((new Date(lot.expiry) - new Date()) / 86400000);
      if (daysLeft < 90) stockMap[lot.productId].expirySoon = true;
    }
  });

  const lines = wms.products
    .filter(function(p){ return p.active; })
    .map(function(p) {
      const s = stockMap[p.id] || { qty: 0 };
      const reorder = p.reorderPoint || 10;
      let icon = '🟢';
      if (s.qty === 0)        icon = '🔴';
      else if (s.qty <= 15)   icon = '🔴';
      else if (s.qty <= reorder) icon = '🟡';
      const expWarn = s.expirySoon ? ' ⚠️انقضا' : '';
      return icon + ' <b>' + (p.name || p.fullName) + '</b>: ' + fmtN(s.qty) + ' ' + (p.unit || 'عدد') + expWarn;
    });

  const text = '📦 <b>موجودی انبار</b>\n\n' + lines.join('\n') +
    '\n\n🟢 کافی  🟡 زیر حد سفارش  🔴 اتمام/بحرانی';

  await sendMsg(chatId, text, { reply_markup: MENU_KB });
}

// ── Callback handler ──────────────────────────────────────────────────────
async function handleCallback(cb) {
  const chatId = cb.message.chat.id;
  const msgId  = cb.message.message_id;
  const data   = cb.data || '';
  const sess   = sessions[chatId];

  await answerCallback(cb.id);

  if (!sess || !sess.username) {
    await sendMsg(chatId, '❌ لطفاً ابتدا وارد شوید: /start');
    return;
  }

  const isManager = ['مدیر', 'سوپر ادمین'].includes(sess.role);

  if (data.startsWith('pf_approve:')) {
    if (!isManager) { await sendMsg(chatId, '❌ فقط مدیر می‌تواند تأیید کند.'); return; }
    const pfId = data.split(':')[1];
    await doApprovePf(chatId, msgId, pfId, sess);
    return;
  }

  if (data.startsWith('pf_reject:')) {
    if (!isManager) { await sendMsg(chatId, '❌ فقط مدیر می‌تواند رد کند.'); return; }
    const pfId = data.split(':')[1];
    sess.state = ST.AWAIT_REJECT;
    sess.pfId  = pfId;
    await sendMsg(chatId, '✏️ دلیل رد پیشفاکتور را بنویسید (یا <code>-</code> برای بدون دلیل):');
    return;
  }

  if (data.startsWith('pf_send:')) {
    const pfId = data.split(':')[1];
    await doSendPf(chatId, msgId, pfId, sess);
    return;
  }
}

// ── Proforma actions ──────────────────────────────────────────────────────
async function doApprovePf(chatId, msgId, pfId, sess) {
  const list = await loadProformas();
  const idx  = list.findIndex(function(p){ return p.id === pfId; });
  if (idx === -1) { await sendMsg(chatId, '❌ پیشفاکتور یافت نشد.'); return; }
  const pf = list[idx];
  if (pf.status !== 'sent') { await sendMsg(chatId, '⚠️ این پیشفاکتور قابل تأیید نیست (وضعیت: ' + pf.status + ')'); return; }
  pf.status      = 'approved';
  pf.respondedAt = new Date().toISOString();
  pf.respondedBy = sess.username;
  list[idx] = pf;
  await saveProformas(list, sess.username);

  await editMsg(chatId, msgId,
    '✅ <b>پیشفاکتور ' + pf.no + ' تأیید شد.</b>\n' +
    '👤 مشتری: ' + (pf.centerName || '—') + '\n' +
    '💰 مبلغ: ' + fmtN(pf.total) + ' ﷼\n' +
    '👑 تأیید توسط: ' + sess.name
  );

  // Notify creator
  await notifyCreator(pf, '✅ پیشفاکتور ' + pf.no + ' توسط ' + sess.name + ' تأیید شد.');
}

async function doRejectPf(chatId, pfId, note, sess) {
  const list = await loadProformas();
  const idx  = list.findIndex(function(p){ return p.id === pfId; });
  if (idx === -1) { await sendMsg(chatId, '❌ پیشفاکتور یافت نشد.'); return; }
  const pf = list[idx];
  if (pf.status !== 'sent') { await sendMsg(chatId, '⚠️ این پیشفاکتور قابل رد نیست.'); return; }
  pf.status      = 'rejected';
  pf.respondedAt = new Date().toISOString();
  pf.respondedBy = sess.username;
  pf.managerNote = (note === '-' ? '' : note);
  list[idx] = pf;
  await saveProformas(list, sess.username);

  await sendMsg(chatId,
    '❌ <b>پیشفاکتور ' + pf.no + ' رد شد.</b>\n' +
    (pf.managerNote ? '📝 دلیل: ' + pf.managerNote : ''),
    { reply_markup: MENU_KB }
  );

  await notifyCreator(pf, '❌ پیشفاکتور ' + pf.no + ' رد شد.' + (pf.managerNote ? '\nدلیل: ' + pf.managerNote : ''));
}

async function doSendPf(chatId, msgId, pfId, sess) {
  const list = await loadProformas();
  const idx  = list.findIndex(function(p){ return p.id === pfId; });
  if (idx === -1) { await sendMsg(chatId, '❌ پیشفاکتور یافت نشد.'); return; }
  const pf = list[idx];
  if (pf.status !== 'draft') { await sendMsg(chatId, '⚠️ این پیشفاکتور قبلاً ارسال شده است.'); return; }
  pf.status = 'sent';
  pf.sentAt = new Date().toISOString();
  list[idx] = pf;
  await saveProformas(list, sess.username);

  await editMsg(chatId, msgId,
    '📤 <b>پیشفاکتور ' + pf.no + ' برای تأیید ارسال شد.</b>\n' +
    '👤 مشتری: ' + (pf.centerName || '—') + '\n' +
    '💰 مبلغ: ' + fmtN(pf.total) + ' ﷼'
  );

  // Notify managers
  await notifyManagers('📄 پیشفاکتور ' + pf.no + ' از ' + sess.name + ' در انتظار تأیید است.\n💰 مبلغ: ' + fmtN(pf.total) + ' ﷼\n👤 مشتری: ' + (pf.centerName||'—'));
}

// ── Notify linked Telegram users ──────────────────────────────────────────
async function notifyCreator(pf, text) {
  const stored = await loadBotSessions();
  for (const [chatId, s] of Object.entries(stored)) {
    if (s.username === pf.createdBy && s.state === ST.IDLE) {
      await sendMsg(parseInt(chatId), text).catch(function(){});
    }
  }
}

async function notifyManagers(text) {
  const stored = await loadBotSessions();
  for (const [chatId, s] of Object.entries(stored)) {
    if (['مدیر', 'سوپر ادمین'].includes(s.role) && s.state === ST.IDLE) {
      await sendMsg(parseInt(chatId), text).catch(function(){});
    }
  }
}

// ── QR Photo handler ──────────────────────────────────────────────────────
async function handlePhoto(chatId, msg) {
  await sendMsg(chatId, '🔍 در حال پردازش تصویر...');

  try {
    // Pick highest-resolution photo
    const photos = msg.photo;
    const best   = photos[photos.length - 1];
    const buf    = await downloadFile(best.file_id);

    const image = await Jimp.read(buf);
    const { data, width, height } = image.bitmap;
    // jsQR needs Uint8ClampedArray RGBA
    const rgba = new Uint8ClampedArray(data);
    const code = jsQR(rgba, width, height);

    if (!code || !code.data) {
      await sendMsg(chatId, '❌ QR کد در تصویر یافت نشد.\nلطفاً تصویر واضح‌تری بفرستید یا کد را دستی وارد کنید.', { reply_markup: MENU_KB });
      return;
    }

    const qrData = code.data.trim();
    await sendMsg(chatId, '📦 کد اسکن شد: <code>' + qrData + '</code>\n\nدر حال جستجو در انبار...');

    // Lookup in WMS
    const wms = await loadWMS();
    let result = null;

    if (wms) {
      // Try lots first
      const lotMatch = (wms.lots || []).find(function(l){
        return l.lotNo === qrData || l.id === qrData;
      });
      if (lotMatch) {
        const prod = (wms.products || []).find(function(p){ return p.id === lotMatch.productId; });
        const wh   = (wms.warehouses || []).find(function(w){ return w.id === lotMatch.warehouseId; });
        const daysLeft = lotMatch.expiry ? Math.ceil((new Date(lotMatch.expiry) - new Date()) / 86400000) : null;
        result =
          '📦 <b>اطلاعات لات</b>\n\n' +
          '🏷 لات: <code>' + lotMatch.lotNo + '</code>\n' +
          '💊 کالا: ' + (prod ? (prod.fullName || prod.name) : '?') + '\n' +
          '🏭 انبار: ' + (wh ? wh.name : '?') + '\n' +
          '📊 موجودی این لات: ' + fmtN(lotMatch.qty) + ' ' + (prod ? prod.unit : 'عدد') + '\n' +
          (lotMatch.expiry ? '📅 انقضا: ' + lotMatch.expiry + (daysLeft !== null ? ' (' + daysLeft + ' روز)' : '') + (daysLeft < 30 ? ' ⚠️' : '') + '\n' : '') +
          (lotMatch.ttacNo ? '📋 TTAC: ' + lotMatch.ttacNo : '');
      } else {
        // Try product
        const prodMatch = (wms.products || []).find(function(p){
          return p.id === qrData || p.catalogCode === qrData || p.ircCode === qrData;
        });
        if (prodMatch) {
          // Sum all lots for this product
          const totalQty = (wms.lots || [])
            .filter(function(l){ return l.productId === prodMatch.id; })
            .reduce(function(s, l){ return s + (l.qty || 0); }, 0);
          result =
            '💊 <b>اطلاعات کالا</b>\n\n' +
            '🏷 نام: ' + (prodMatch.fullName || prodMatch.name) + '\n' +
            '🔖 کد کاتالوگ: ' + (prodMatch.catalogCode || '—') + '\n' +
            '📋 IRC: ' + (prodMatch.ircCode || '—') + '\n' +
            '📦 موجودی کل: ' + fmtN(totalQty) + ' ' + prodMatch.unit + '\n' +
            '🔄 حد سفارش مجدد: ' + (prodMatch.reorderPoint || 10) + ' ' + prodMatch.unit;
        }
      }
    }

    if (result) {
      await sendMsg(chatId, result, { reply_markup: MENU_KB });
    } else {
      await sendMsg(chatId,
        '🔍 کد <code>' + qrData + '</code> در انبار یافت نشد.\n\nممکن است این کالا هنوز وارد سیستم WMS نشده باشد.',
        { reply_markup: MENU_KB }
      );
    }
  } catch(e) {
    console.error('[bot] QR scan error:', e.message);
    await sendMsg(chatId, '❌ خطا در پردازش تصویر: ' + e.message, { reply_markup: MENU_KB });
  }
}

// ── Long-polling loop ─────────────────────────────────────────────────────
let _offset  = 0;
let _running = false;

async function poll() {
  if (!TOKEN) {
    console.log('[bot] TELEGRAM_BOT_TOKEN not set — bot disabled');
    return;
  }
  _running = true;
  console.log('[bot] Telegram bot started (long-polling)');

  while (_running) {
    try {
      const r = await tgCall('getUpdates', {
        offset:          _offset,
        timeout:         25,
        allowed_updates: ['message', 'callback_query'],
      });
      if (r.ok && r.result && r.result.length) {
        for (const upd of r.result) {
          _offset = upd.update_id + 1;
          handleUpdate(upd).catch(function(e){ console.error('[bot] update error:', e.message); });
        }
      }
    } catch(e) {
      console.error('[bot] poll error:', e.message);
      await new Promise(function(res){ setTimeout(res, 5000); });
    }
  }
}

function stop() { _running = false; }

// ── External notify API (called from proforma route) ─────────────────────
async function notifyAll(text) {
  try {
    const stored = await loadBotSessions();
    for (const [chatId, s] of Object.entries(stored)) {
      if (s.username && s.state === ST.IDLE) {
        await sendMsg(parseInt(chatId), text).catch(function(){});
      }
    }
  } catch(e) {}
}

module.exports = { poll, stop, notifyManagers, notifyAll };
