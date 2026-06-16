'use strict';

// ════════════════════════════════════════════════════════════════
// TELEGRAM BOT — آتنا زیست درمان
// Features: proforma approval, inventory check, QR product scan
// Auth: /start → username → password (verified against CRM DB)
// Polling mode (no webhook needed)
// ════════════════════════════════════════════════════════════════

const https  = require('https');
const Jimp   = require('jimp');
const jsQR   = require('jsqr');
const bcrypt = require('bcryptjs');
const { query } = require('../db');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// ── In-memory sessions: chatId → { username, name, role, state, pendingUser, pfId } ──
const sessions = {};

// ── Conversation states ───────────────────────────────────────────────────
const ST = {
  IDLE:           'idle',
  AWAIT_USERNAME: 'await_username',
  AWAIT_PASSWORD: 'await_password',
  AWAIT_REJECT:   'await_reject',
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

// ── Session persistence (still in app_data blob — lightweight) ────────────
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
function fmtN(n) { return Number(n || 0).toLocaleString('fa-IR'); }

// ── Status labels ─────────────────────────────────────────────────────────
const PF_LABELS = { draft:'پیش‌نویس', sent:'ارسال شده', approved:'✅ تأیید', rejected:'❌ رد', cancelled:'لغو' };

// ── Main menu keyboards ───────────────────────────────────────────────────
const MENU_KB = {
  keyboard: [
    [{ text: '☀️ برنامه امروز' }, { text: '📄 پیشفاکتورها' }],
    [{ text: '🔍 اسکن QR کالا' }, { text: '❓ راهنما' }],
  ],
  resize_keyboard: true,
};

const MENU_KB_MANAGER = {
  keyboard: [
    [{ text: '☀️ برنامه امروز' }, { text: '📄 پیشفاکتورها' }],
    [{ text: '📦 موجودی انبار' }, { text: '🔍 اسکن QR کالا' }],
    [{ text: '❓ راهنما' }],
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

    // ── Handle /start and /logout BEFORE state machine ───────────────────
    if (text === '/start' || text === '/help' || text === '❓ راهنما') {
      if (!sess.username) {
        sess.state = ST.AWAIT_USERNAME;
        await sendMsg(chatId,
          '🔐 <b>ورود به سیستم</b>\n\nلطفاً نام کاربری CRM خود را وارد کنید:\n(مثال: <code>Hamidreza.soltanian</code>)'
        );
      } else {
        const isManager = ['مدیر', 'سوپر ادمین'].includes(sess.role);
        await sendMsg(chatId,
          '👋 سلام <b>' + sess.name + '</b>\n\n' +
          '📋 <b>دستورات موجود:</b>\n' +
          '📄 پیشفاکتورها\n' +
          '📦 موجودی انبار\n' +
          '☀️ برنامه امروز\n' +
          '🔍 اسکن QR کالا\n' +
          '/logout — خروج از حساب',
          { reply_markup: isManager ? MENU_KB_MANAGER : MENU_KB }
        );
      }
      return;
    }

    if (text === '/logout') {
      delete sessions[chatId];
      await persistSession(chatId, true);
      await sendMsg(chatId, '👋 از سیستم خارج شدید.', { reply_markup: { remove_keyboard: true } });
      return;
    }

    // ── State machine ─────────────────────────────────────────────────────
    if (sess.state === ST.AWAIT_USERNAME) {
      if (!text || text.startsWith('/')) {
        await sendMsg(chatId, '🔐 <b>ورود به سیستم</b>\n\nلطفاً نام کاربری CRM خود را وارد کنید:\n(مثال: <code>Hamidreza.soltanian</code>)');
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
      const isManagerNew = ['مدیر', 'سوپر ادمین'].includes(user.role);
      await sendMsg(chatId,
        '✅ <b>خوش آمدید، ' + user.display_name + '!</b>\n' +
        'نقش: ' + user.role + (isManagerNew ? ' 👑' : '') + '\n\n' +
        'از منو زیر انتخاب کنید:',
        { reply_markup: isManagerNew ? MENU_KB_MANAGER : MENU_KB }
      );
      return;
    }

    if (sess.state === ST.AWAIT_REJECT) {
      const { pfId } = sess;
      delete sess.pfId;
      sess.state = ST.IDLE;
      await doRejectPf(chatId, pfId, text, sess);
      return;
    }

    // ── Require login for commands below ──────────────────────────────────
    if (!sess.username) {
      sess.state = ST.AWAIT_USERNAME;
      await sendMsg(chatId, '🔐 ابتدا وارد شوید. نام کاربری CRM خود را بنویسید:');
      return;
    }

    if (text === '📄 پیشفاکتورها' || text === '/proformas') {
      await handleProformas(chatId, sess);
      return;
    }

    if (text === '📦 موجودی انبار' || text === '/inventory') {
      await handleInventory(chatId);
      return;
    }

    if (text === '☀️ برنامه امروز' || text === '/today') {
      await handleTodaySchedule(chatId, sess);
      return;
    }

    if (text === '🔍 اسکن QR کالا' || text === '/scan') {
      await sendMsg(chatId, '📸 عکس QR کد کالا را بفرستید:', { reply_markup: { force_reply: true } });
      return;
    }

    const isManagerCmd = ['مدیر', 'سوپر ادمین'].includes(sess.role);
    await sendMsg(chatId, 'از منو زیر انتخاب کنید:', { reply_markup: isManagerCmd ? MENU_KB_MANAGER : MENU_KB });

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

// ── Proformas handler — reads from SQL ────────────────────────────────────
async function handleProformas(chatId, sess) {
  const isManager = ['مدیر', 'سوپر ادمین'].includes(sess.role);

  let rows;
  if (isManager) {
    const r = await query(
      `SELECT * FROM proformas WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 10`
    );
    rows = r.rows;
  } else {
    const r = await query(
      `SELECT * FROM proformas WHERE created_by = $1
       AND status IN ('draft','sent','approved','rejected')
       ORDER BY created_at DESC LIMIT 10`,
      [sess.username]
    );
    rows = r.rows;
  }

  if (!rows.length) {
    const msg = isManager
      ? '✅ هیچ پیشفاکتور در انتظار تأییدی وجود ندارد.'
      : '📄 پیشفاکتوری ثبت نشده است.';
    await sendMsg(chatId, msg, { reply_markup: MENU_KB });
    return;
  }

  for (const pf of rows) {
    const items    = pf.items || [];
    const itemList = items.slice(0, 3).map(function(i){ return '  • ' + i.name + ' × ' + i.qty; }).join('\n');
    const moreItems = items.length > 3 ? '\n  و ' + (items.length - 3) + ' ردیف دیگر...' : '';

    let text =
      '📄 <b>' + pf.no + '</b>\n' +
      '👤 مشتری: ' + (pf.center_name || '—') + '\n' +
      '📅 تاریخ: ' + (pf.jalali_date || '—') + '\n' +
      '💰 مبلغ: <b>' + fmtN(pf.total) + ' ﷼</b>\n' +
      '🔖 وضعیت: ' + (PF_LABELS[pf.status] || pf.status) + '\n' +
      '📦 کالاها:\n' + itemList + moreItems;

    if (pf.note) text += '\n📝 ' + pf.note;
    if (pf.manager_note) text += '\n👑 یادداشت مدیر: ' + pf.manager_note;

    let inlineKb;
    if (isManager && pf.status === 'sent') {
      inlineKb = { inline_keyboard: [[
        { text: '✅ تأیید', callback_data: 'pf_approve:' + pf.id },
        { text: '❌ رد',    callback_data: 'pf_reject:'  + pf.id },
      ]] };
    } else if (!isManager && pf.status === 'draft' && pf.created_by === sess.username) {
      inlineKb = { inline_keyboard: [[
        { text: '📤 ارسال برای تأیید', callback_data: 'pf_send:' + pf.id },
      ]] };
    }

    await sendMsg(chatId, text, inlineKb ? { reply_markup: inlineKb } : undefined);
  }
}

// ── Inventory handler — SQL aggregate ────────────────────────────────────
async function handleInventory(chatId) {
  const r = await query(`
    SELECT
      p.id,
      p.name,
      p.full_name,
      p.unit,
      p.reorder_point,
      COALESCE(SUM(l.qty), 0)::int         AS total_qty,
      MIN(l.expiry)                          AS nearest_expiry,
      BOOL_OR(l.expiry < NOW() + INTERVAL '90 days' AND l.expiry IS NOT NULL) AS expiry_soon
    FROM wms_products p
    LEFT JOIN wms_lots l ON l.product_id = p.id AND l.qty > 0
    WHERE p.active = true
    GROUP BY p.id, p.name, p.full_name, p.unit, p.reorder_point
    ORDER BY p.name
  `);

  if (!r.rows.length) {
    await sendMsg(chatId, '⚠️ هیچ کالایی در انبار ثبت نشده است.\nابتدا از طریق پنل وب، WMS را راه‌اندازی کنید.', { reply_markup: MENU_KB });
    return;
  }

  const lines = r.rows.map(function(p) {
    const qty     = p.total_qty;
    const reorder = p.reorder_point || 10;
    let icon = qty === 0 ? '🔴' : qty <= reorder ? '🟡' : '🟢';
    const expWarn = p.expiry_soon ? ' ⚠️انقضا' : '';
    const label   = p.full_name || p.name;
    return icon + ' <b>' + label + '</b>: ' + fmtN(qty) + ' ' + (p.unit || 'عدد') + expWarn;
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
    await doApprovePf(chatId, msgId, data.split(':')[1], sess);
    return;
  }

  if (data.startsWith('pf_reject:')) {
    if (!isManager) { await sendMsg(chatId, '❌ فقط مدیر می‌تواند رد کند.'); return; }
    sess.state = ST.AWAIT_REJECT;
    sess.pfId  = data.split(':')[1];
    await sendMsg(chatId, '✏️ دلیل رد پیشفاکتور را بنویسید (یا <code>-</code> برای بدون دلیل):');
    return;
  }

  if (data.startsWith('pf_send:')) {
    await doSendPf(chatId, msgId, data.split(':')[1], sess);
    return;
  }
}

// ── Proforma actions — all SQL ────────────────────────────────────────────
async function doApprovePf(chatId, msgId, pfId, sess) {
  const r = await query(
    `UPDATE proformas
     SET status='approved', responded_at=NOW(), responded_by=$2, updated_at=NOW()
     WHERE id=$1 AND status='sent'
     RETURNING *`,
    [pfId, sess.username]
  );
  if (!r.rows.length) {
    await sendMsg(chatId, '⚠️ این پیشفاکتور قابل تأیید نیست یا یافت نشد.');
    return;
  }
  const pf = r.rows[0];
  await editMsg(chatId, msgId,
    '✅ <b>پیشفاکتور ' + pf.no + ' تأیید شد.</b>\n' +
    '👤 مشتری: ' + (pf.center_name || '—') + '\n' +
    '💰 مبلغ: ' + fmtN(pf.total) + ' ﷼\n' +
    '👑 تأیید توسط: ' + sess.name
  );
  await notifyCreator(pf.created_by, '✅ پیشفاکتور ' + pf.no + ' توسط ' + sess.name + ' تأیید شد.');
}

async function doRejectPf(chatId, pfId, note, sess) {
  const managerNote = (note === '-' ? '' : note);
  const r = await query(
    `UPDATE proformas
     SET status='rejected', responded_at=NOW(), responded_by=$2, manager_note=$3, updated_at=NOW()
     WHERE id=$1 AND status='sent'
     RETURNING *`,
    [pfId, sess.username, managerNote]
  );
  if (!r.rows.length) {
    await sendMsg(chatId, '⚠️ این پیشفاکتور قابل رد نیست یا یافت نشد.', { reply_markup: MENU_KB });
    return;
  }
  const pf = r.rows[0];
  await sendMsg(chatId,
    '❌ <b>پیشفاکتور ' + pf.no + ' رد شد.</b>\n' +
    (managerNote ? '📝 دلیل: ' + managerNote : ''),
    { reply_markup: MENU_KB }
  );
  await notifyCreator(pf.created_by,
    '❌ پیشفاکتور ' + pf.no + ' رد شد.' + (managerNote ? '\nدلیل: ' + managerNote : '')
  );
}

async function doSendPf(chatId, msgId, pfId, sess) {
  const r = await query(
    `UPDATE proformas
     SET status='sent', sent_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND status='draft' AND created_by=$2
     RETURNING *`,
    [pfId, sess.username]
  );
  if (!r.rows.length) {
    await sendMsg(chatId, '⚠️ این پیشفاکتور قبلاً ارسال شده یا یافت نشد.');
    return;
  }
  const pf = r.rows[0];
  await editMsg(chatId, msgId,
    '📤 <b>پیشفاکتور ' + pf.no + ' برای تأیید ارسال شد.</b>\n' +
    '👤 مشتری: ' + (pf.center_name || '—') + '\n' +
    '💰 مبلغ: ' + fmtN(pf.total) + ' ﷼'
  );
  await notifyManagers(
    '📄 پیشفاکتور ' + pf.no + ' از ' + sess.name + ' در انتظار تأیید است.\n' +
    '💰 مبلغ: ' + fmtN(pf.total) + ' ﷼\n' +
    '👤 مشتری: ' + (pf.center_name || '—')
  );
}

// ── Notify linked Telegram users ──────────────────────────────────────────
async function notifyCreator(createdBy, text) {
  const stored = await loadBotSessions();
  for (const [chatId, s] of Object.entries(stored)) {
    if (s.username === createdBy && s.state === ST.IDLE) {
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

// ── QR Photo handler — SQL lookup ─────────────────────────────────────────
async function handlePhoto(chatId, msg) {
  await sendMsg(chatId, '🔍 در حال پردازش تصویر...');

  try {
    const photos = msg.photo;
    const best   = photos[photos.length - 1];
    const buf    = await downloadFile(best.file_id);

    const image = await Jimp.read(buf);
    const { data, width, height } = image.bitmap;
    const rgba = new Uint8ClampedArray(data);
    const code = jsQR(rgba, width, height);

    if (!code || !code.data) {
      await sendMsg(chatId, '❌ QR کد در تصویر یافت نشد.\nلطفاً تصویر واضح‌تری بفرستید.', { reply_markup: MENU_KB });
      return;
    }

    const qrData = code.data.trim();
    await sendMsg(chatId, '📦 کد اسکن شد: <code>' + qrData + '</code>\n\nدر حال جستجو در انبار...');

    // Try lot lookup first (by lot_no or id)
    const lotRes = await query(`
      SELECT l.*, p.name AS prod_name, p.full_name AS prod_full_name, p.unit,
             w.name AS wh_name
      FROM wms_lots l
      JOIN wms_products p ON p.id = l.product_id
      LEFT JOIN wms_warehouses w ON w.id = l.warehouse_id
      WHERE l.lot_no = $1 OR l.id = $1
      LIMIT 1
    `, [qrData]);

    if (lotRes.rows.length) {
      const l = lotRes.rows[0];
      const daysLeft = l.expiry ? Math.ceil((new Date(l.expiry) - new Date()) / 86400000) : null;
      const expLine  = l.expiry
        ? '\n📅 انقضا: ' + l.expiry.toISOString().slice(0, 10) +
          (daysLeft !== null ? ' (' + daysLeft + ' روز)' : '') +
          (daysLeft !== null && daysLeft < 30 ? ' ⚠️' : '')
        : '';
      const ttac = l.ttac_no ? '\n📋 TTAC: ' + l.ttac_no : '';
      await sendMsg(chatId,
        '📦 <b>اطلاعات لات</b>\n\n' +
        '🏷 لات: <code>' + l.lot_no + '</code>\n' +
        '💊 کالا: ' + (l.prod_full_name || l.prod_name) + '\n' +
        '🏭 انبار: ' + (l.wh_name || '—') + '\n' +
        '📊 موجودی این لات: ' + fmtN(l.qty) + ' ' + l.unit + expLine + ttac,
        { reply_markup: MENU_KB }
      );
      return;
    }

    // Try product lookup (by catalog_code or irc_code)
    const prodRes = await query(`
      SELECT p.*, COALESCE(SUM(l.qty), 0)::int AS total_qty
      FROM wms_products p
      LEFT JOIN wms_lots l ON l.product_id = p.id
      WHERE p.id = $1 OR p.catalog_code = $1 OR p.irc_code = $1
      GROUP BY p.id
      LIMIT 1
    `, [qrData]);

    if (prodRes.rows.length) {
      const p = prodRes.rows[0];
      await sendMsg(chatId,
        '💊 <b>اطلاعات کالا</b>\n\n' +
        '🏷 نام: ' + (p.full_name || p.name) + '\n' +
        '🔖 کد کاتالوگ: ' + (p.catalog_code || '—') + '\n' +
        '📋 IRC: ' + (p.irc_code || '—') + '\n' +
        '📦 موجودی کل: ' + fmtN(p.total_qty) + ' ' + p.unit + '\n' +
        '🔄 حد سفارش مجدد: ' + (p.reorder_point || 10) + ' ' + p.unit,
        { reply_markup: MENU_KB }
      );
      return;
    }

    await sendMsg(chatId,
      '🔍 کد <code>' + qrData + '</code> در انبار یافت نشد.\n\nممکن است این کالا هنوز وارد سیستم WMS نشده باشد.',
      { reply_markup: MENU_KB }
    );
  } catch(e) {
    console.error('[bot] QR scan error:', e.message);
    await sendMsg(chatId, '❌ خطا در پردازش تصویر: ' + e.message, { reply_markup: MENU_KB });
  }
}


// ── Minimal Gregorian → Jalali converter ─────────────────────────────────
function toJalali(date) {
  const gy = date.getFullYear(), gm = date.getMonth() + 1, gd = date.getDate();
  const g_d_no = 365 * gy + Math.floor((gy + 3) / 4) - Math.floor((gy + 99) / 100) + Math.floor((gy + 399) / 400);
  const j_d_no = g_d_no - 79;
  const j_np   = Math.floor(j_d_no / 12053);
  let jy        = 979 + 33 * j_np;
  let jd        = j_d_no % 12053;
  jy           += 4 * Math.floor(jd / 1461);
  jd           %= 1461;
  if (jd >= 366) { jy += Math.floor((jd - 1) / 365); jd = (jd - 1) % 365; }
  const jm_days = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  let jm = 0;
  for (let i = 0; i < 12; i++) {
    if (jd < jm_days[i]) { jm = i + 1; jd++; break; }
    jd -= jm_days[i];
  }
  const p2 = function(n){ return String(n).padStart(2,'0'); };
  return jy + '/' + p2(jm) + '/' + p2(jd);
}

// ── Today's schedule — reads weekEntries from app_data blob ──────────────
async function handleTodaySchedule(chatId, sess) {
  const todayStr = toJalali(new Date());

  let dbBlob;
  try {
    const r = await query("SELECT value FROM app_data WHERE key = 'main'");
    dbBlob = r.rows.length ? r.rows[0].value : null;
  } catch(e) { dbBlob = null; }

  if (!dbBlob || !dbBlob.weekEntries) {
    await sendMsg(chatId, '📅 برنامه‌ای برای امروز (' + todayStr + ') یافت نشد.', { reply_markup: MENU_KB });
    return;
  }

  const entries = Object.values(dbBlob.weekEntries).filter(function(we) {
    if (we.scheduledDate !== todayStr) return false;
    const owner = we.addedBy || we.owner || '';
    // managers see all; experts see only their own
    if (['مدیر', 'سوپر ادمین'].includes(sess.role)) return true;
    return owner === sess.username;
  });

  if (!entries.length) {
    await sendMsg(chatId,
      '☀️ <b>برنامه امروز — ' + todayStr + '</b>\n\nهیچ مرکزی برای امروز برنامه‌ریزی نشده است.',
      { reply_markup: MENU_KB }
    );
    return;
  }

  const isManager = ['مدیر', 'سوپر ادمین'].includes(sess.role);
  const doneCount = entries.filter(function(e){ return e.done; }).length;
  const actionIcon = { call: '📞', visit: '🚗' };

  const lines = entries.map(function(we) {
    const done   = we.done ? '✅' : '⬜';
    const act    = actionIcon[we.actionType] || '📋';
    const name   = we.centerName || we.rid || '—';
    const owner  = isManager ? ' (' + (we.addedBy || '') + ')' : '';
    return done + ' ' + act + ' ' + name + owner;
  });

  const text =
    '☀️ <b>برنامه امروز — ' + todayStr + '</b>\n' +
    '✅ ' + doneCount + ' از ' + entries.length + ' انجام شده\n\n' +
    lines.join('\n');

  await sendMsg(chatId, text, { reply_markup: isManager ? MENU_KB_MANAGER : MENU_KB });
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
