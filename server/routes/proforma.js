'use strict';

const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// ── Helper: get proformas list from app_data ────────────────────────────────
async function _load() {
  const r = await query(`SELECT value FROM app_data WHERE key = 'proformas'`);
  return r.rows.length ? r.rows[0].value : [];
}

async function _save(list, username) {
  await query(
    `INSERT INTO app_data (key, value, updated_at, updated_by)
     VALUES ('proformas', $1, NOW(), $2)
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW(), updated_by = $2`,
    [JSON.stringify(list), username]
  );
}

// ── GET /api/proforma — list (with optional status filter) ──────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const list = await _load();
    const { status, center } = req.query;
    let result = list;
    if (status) result = result.filter(p => p.status === status);
    if (center) result = result.filter(p => p.centerKey === center);
    // Non-managers only see their own
    const isManager = ['مدیر', 'سوپر ادمین'].includes(req.user.role);
    if (!isManager) result = result.filter(p => p.createdBy === req.user.username);
    res.json(result.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
  } catch (e) {
    console.error('[proforma GET]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/proforma — create ─────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const list = await _load();
    const { centerKey, centerName, items, note, taxPct, discountPct, jalaliDate, validDays } = req.body || {};
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'حداقل یک ردیف کالا لازم است' });
    }

    // Auto-number: PF-1404-0001
    const year = (jalaliDate || '').split('/')[0] || new Date().getFullYear().toString();
    const existing = list.filter(p => (p.no || '').startsWith(`PF-${year}-`));
    const seq = String(existing.length + 1).padStart(4, '0');
    const no = `PF-${year}-${seq}`;

    const subtotal = items.reduce((s, i) => s + (Number(i.unitPrice) * Number(i.qty) || 0), 0);
    const discAmt  = Math.round(subtotal * (Number(discountPct) || 0) / 100);
    const taxAmt   = Math.round((subtotal - discAmt) * (Number(taxPct) || 9) / 100);
    const total    = subtotal - discAmt + taxAmt;

    const pf = {
      id: 'pf_' + Date.now().toString(36),
      no,
      jalaliDate: jalaliDate || '',
      validDays: Number(validDays) || 30,
      centerKey: centerKey || '',
      centerName: centerName || '',
      items: items.map(i => ({
        prodId:    i.prodId    || '',
        name:      i.name      || '',
        unit:      i.unit      || 'عدد',
        qty:       Number(i.qty) || 1,
        unitPrice: Number(i.unitPrice) || 0,
        lineTotal: (Number(i.qty) || 1) * (Number(i.unitPrice) || 0),
      })),
      subtotal,
      discountPct: Number(discountPct) || 0,
      discAmt,
      taxPct:  Number(taxPct) !== undefined ? Number(taxPct) : 9,
      taxAmt,
      total,
      note: note || '',
      status: 'draft',
      createdBy: req.user.username,
      createdAt: new Date().toISOString(),
      sentAt: null,
      respondedAt: null,
      respondedBy: null,
      managerNote: '',
    };

    list.push(pf);
    await _save(list, req.user.username);
    res.status(201).json(pf);
  } catch (e) {
    console.error('[proforma POST]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/proforma/:id ───────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const list = await _load();
    const pf = list.find(p => p.id === req.params.id);
    if (!pf) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    res.json(pf);
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── PUT /api/proforma/:id — update draft ────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const list = await _load();
    const idx = list.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    const pf = list[idx];
    if (pf.status !== 'draft') {
      return res.status(400).json({ error: 'فقط پیش‌نویس قابل ویرایش است' });
    }
    const { items, note, taxPct, discountPct, jalaliDate, validDays, centerKey, centerName } = req.body || {};
    if (items) {
      pf.items = items.map(i => ({
        prodId: i.prodId || '', name: i.name || '', unit: i.unit || 'عدد',
        qty: Number(i.qty) || 1, unitPrice: Number(i.unitPrice) || 0,
        lineTotal: (Number(i.qty) || 1) * (Number(i.unitPrice) || 0),
      }));
      pf.subtotal  = pf.items.reduce((s, i) => s + i.lineTotal, 0);
      pf.discountPct = Number(discountPct) || pf.discountPct;
      pf.taxPct      = taxPct !== undefined ? Number(taxPct) : pf.taxPct;
      pf.discAmt  = Math.round(pf.subtotal * pf.discountPct / 100);
      pf.taxAmt   = Math.round((pf.subtotal - pf.discAmt) * pf.taxPct / 100);
      pf.total    = pf.subtotal - pf.discAmt + pf.taxAmt;
    }
    if (note !== undefined)       pf.note       = note;
    if (jalaliDate !== undefined) pf.jalaliDate = jalaliDate;
    if (validDays  !== undefined) pf.validDays  = Number(validDays);
    if (centerKey  !== undefined) pf.centerKey  = centerKey;
    if (centerName !== undefined) pf.centerName = centerName;
    pf.updatedAt = new Date().toISOString();
    list[idx] = pf;
    await _save(list, req.user.username);
    res.json(pf);
  } catch (e) {
    console.error('[proforma PUT]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/proforma/:id/action — workflow transitions ───────────────────
// body: { action: 'send'|'approve'|'reject'|'cancel'|'reopen', note }
const TRANSITIONS = {
  draft:    ['send', 'cancel'],
  sent:     ['approve', 'reject', 'cancel'],
  approved: ['cancel'],
  rejected: ['reopen'],
  cancelled: ['reopen'],
};

router.post('/:id/action', requireAuth, async (req, res) => {
  try {
    const { action, note } = req.body || {};
    const list = await _load();
    const idx  = list.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    const pf = list[idx];

    const allowed = TRANSITIONS[pf.status] || [];
    if (!allowed.includes(action)) {
      return res.status(400).json({ error: `عملیات '${action}' در وضعیت '${pf.status}' مجاز نیست` });
    }

    const isManager = ['مدیر', 'سوپر ادمین'].includes(req.user.role);

    if (action === 'send') {
      pf.status = 'sent';
      pf.sentAt = new Date().toISOString();
    } else if (action === 'approve') {
      if (!isManager) return res.status(403).json({ error: 'فقط مدیر می‌تواند تأیید کند' });
      pf.status = 'approved';
      pf.respondedAt  = new Date().toISOString();
      pf.respondedBy  = req.user.username;
      pf.managerNote  = note || '';
    } else if (action === 'reject') {
      if (!isManager) return res.status(403).json({ error: 'فقط مدیر می‌تواند رد کند' });
      pf.status = 'rejected';
      pf.respondedAt  = new Date().toISOString();
      pf.respondedBy  = req.user.username;
      pf.managerNote  = note || '';
    } else if (action === 'cancel') {
      pf.status = 'cancelled';
    } else if (action === 'reopen') {
      pf.status = 'draft';
      pf.respondedAt = null;
      pf.respondedBy = null;
      pf.managerNote = '';
    }

    pf.updatedAt = new Date().toISOString();
    list[idx] = pf;
    await _save(list, req.user.username);
    res.json(pf);
  } catch (e) {
    console.error('[proforma action]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── DELETE /api/proforma/:id — only draft/cancelled ─────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const list = await _load();
    const idx = list.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    if (!['draft', 'cancelled'].includes(list[idx].status)) {
      return res.status(400).json({ error: 'فقط پیش‌نویس یا لغو شده را می‌توان حذف کرد' });
    }
    list.splice(idx, 1);
    await _save(list, req.user.username);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

module.exports = router;
