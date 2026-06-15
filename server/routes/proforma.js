'use strict';

const express    = require('express');
const { z }      = require('zod');
const { query }  = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// ── Zod schemas ────────────────────────────────────────────────────────────
const ItemSchema = z.object({
  prodId:    z.string().default(''),
  name:      z.string().min(1, 'نام کالا الزامی است'),
  unit:      z.string().default('عدد'),
  qty:       z.coerce.number().min(1),
  unitPrice: z.coerce.number().min(0),
});

const CreateSchema = z.object({
  centerKey:   z.string().default(''),
  centerName:  z.string().default(''),
  items:       z.array(ItemSchema).min(1, 'حداقل یک ردیف لازم است'),
  note:        z.string().default(''),
  taxPct:      z.coerce.number().min(0).max(100).default(9),
  discountPct: z.coerce.number().min(0).max(100).default(0),
  jalaliDate:  z.string().default(''),
  validDays:   z.coerce.number().min(1).max(365).default(30),
});

const ActionSchema = z.object({
  action: z.enum(['send','approve','reject','cancel','reopen']),
  note:   z.string().default(''),
});

// ── Helper: validate with zod, return 400 on error ─────────────────────────
function validate(schema, data, res) {
  const r = schema.safeParse(data);
  if (!r.success) {
    res.status(400).json({ error: r.error.errors[0].message });
    return null;
  }
  return r.data;
}

// ── Helper: build row object from DB row ───────────────────────────────────
function rowToObj(r) {
  return {
    id:          r.id,
    no:          r.no,
    jalaliDate:  r.jalali_date,
    validDays:   r.valid_days,
    centerKey:   r.center_key,
    centerName:  r.center_name,
    items:       r.items,
    subtotal:    Number(r.subtotal),
    discountPct: Number(r.discount_pct),
    discAmt:     Number(r.disc_amt),
    taxPct:      Number(r.tax_pct),
    taxAmt:      Number(r.tax_amt),
    total:       Number(r.total),
    note:        r.note,
    status:      r.status,
    createdBy:   r.created_by,
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
    sentAt:      r.sent_at,
    respondedAt: r.responded_at,
    respondedBy: r.responded_by,
    managerNote: r.manager_note,
  };
}

// ── GET /api/proforma ───────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, center } = req.query;
    const isManager = ['مدیر', 'سوپر ادمین'].includes(req.user.role);

    const conditions = [];
    const params     = [];
    let   idx        = 1;

    if (status) { conditions.push(`status = $${idx++}`); params.push(status); }
    if (center) { conditions.push(`center_key = $${idx++}`); params.push(center); }
    if (!isManager) { conditions.push(`created_by = $${idx++}`); params.push(req.user.username); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows  = await query(
      `SELECT * FROM proformas ${where} ORDER BY created_at DESC LIMIT 200`,
      params
    );
    res.json(rows.rows.map(rowToObj));
  } catch(e) {
    console.error('[proforma GET]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/proforma — create ─────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const d = validate(CreateSchema, req.body, res);
    if (!d) return;

    // Auto-number PF-1404-0001
    const year = (d.jalaliDate || '').split('/')[0] || String(new Date().getFullYear());
    const countRes = await query(
      `SELECT COUNT(*) FROM proformas WHERE no LIKE $1`,
      [`PF-${year}-%`]
    );
    const seq = String(parseInt(countRes.rows[0].count) + 1).padStart(4, '0');
    const no  = `PF-${year}-${seq}`;

    const subtotal  = d.items.reduce(function(s, i){ return s + i.qty * i.unitPrice; }, 0);
    const discAmt   = Math.round(subtotal * d.discountPct / 100);
    const taxAmt    = Math.round((subtotal - discAmt) * d.taxPct / 100);
    const total     = subtotal - discAmt + taxAmt;
    const itemsFull = d.items.map(function(i){ return Object.assign({}, i, { lineTotal: i.qty * i.unitPrice }); });

    const id = 'pf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    const r = await query(
      `INSERT INTO proformas
         (id,no,jalali_date,valid_days,center_key,center_name,items,
          subtotal,discount_pct,disc_amt,tax_pct,tax_amt,total,
          note,status,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'draft',$15,NOW(),NOW())
       RETURNING *`,
      [id, no, d.jalaliDate||null, d.validDays, d.centerKey, d.centerName,
       JSON.stringify(itemsFull), subtotal, d.discountPct, discAmt,
       d.taxPct, taxAmt, total, d.note, req.user.username]
    );
    res.status(201).json(rowToObj(r.rows[0]));
  } catch(e) {
    console.error('[proforma POST]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/proforma/:id ───────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM proformas WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    res.json(rowToObj(r.rows[0]));
  } catch(e) { res.status(500).json({ error: 'خطای سرور' }); }
});

// ── PUT /api/proforma/:id — update draft ────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const existing = await query('SELECT * FROM proformas WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    if (existing.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'فقط پیش‌نویس قابل ویرایش است' });
    }

    const d = validate(CreateSchema.partial(), req.body, res);
    if (!d) return;

    const pf = rowToObj(existing.rows[0]);
    const items     = d.items ? d.items.map(function(i){ return Object.assign({}, i, { lineTotal: i.qty * i.unitPrice }); }) : pf.items;
    const taxPct    = d.taxPct      !== undefined ? d.taxPct      : pf.taxPct;
    const discPct   = d.discountPct !== undefined ? d.discountPct : pf.discountPct;
    const subtotal  = items.reduce(function(s, i){ return s + (i.lineTotal || i.qty * i.unitPrice); }, 0);
    const discAmt   = Math.round(subtotal * discPct / 100);
    const taxAmt    = Math.round((subtotal - discAmt) * taxPct / 100);
    const total     = subtotal - discAmt + taxAmt;

    const r = await query(
      `UPDATE proformas SET
         jalali_date=$1, valid_days=$2, center_key=$3, center_name=$4,
         items=$5, subtotal=$6, discount_pct=$7, disc_amt=$8,
         tax_pct=$9, tax_amt=$10, total=$11, note=$12, updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [d.jalaliDate||pf.jalaliDate, d.validDays||pf.validDays,
       d.centerKey||pf.centerKey, d.centerName||pf.centerName,
       JSON.stringify(items), subtotal, discPct, discAmt,
       taxPct, taxAmt, total, d.note!==undefined?d.note:pf.note,
       req.params.id]
    );
    res.json(rowToObj(r.rows[0]));
  } catch(e) {
    console.error('[proforma PUT]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/proforma/:id/action — workflow ────────────────────────────────
const TRANSITIONS = {
  draft:     ['send','cancel'],
  sent:      ['approve','reject','cancel'],
  approved:  ['cancel'],
  rejected:  ['reopen'],
  cancelled: ['reopen'],
};

router.post('/:id/action', requireAuth, async (req, res) => {
  try {
    const d = validate(ActionSchema, req.body, res);
    if (!d) return;

    const existing = await query('SELECT * FROM proformas WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    const pf = existing.rows[0];

    const allowed = TRANSITIONS[pf.status] || [];
    if (!allowed.includes(d.action)) {
      return res.status(400).json({
        error: `عملیات '${d.action}' در وضعیت '${pf.status}' مجاز نیست`,
      });
    }

    const isManager = ['مدیر', 'سوپر ادمین'].includes(req.user.role);

    let updateSQL = '';
    let params    = [];

    if (d.action === 'send') {
      updateSQL = `SET status='sent', sent_at=NOW(), updated_at=NOW() WHERE id=$1`;
      params    = [req.params.id];
    } else if (d.action === 'approve') {
      if (!isManager) return res.status(403).json({ error: 'فقط مدیر می‌تواند تأیید کند' });
      updateSQL = `SET status='approved', responded_at=NOW(), responded_by=$2, manager_note=$3, updated_at=NOW() WHERE id=$1`;
      params    = [req.params.id, req.user.username, d.note];
    } else if (d.action === 'reject') {
      if (!isManager) return res.status(403).json({ error: 'فقط مدیر می‌تواند رد کند' });
      updateSQL = `SET status='rejected', responded_at=NOW(), responded_by=$2, manager_note=$3, updated_at=NOW() WHERE id=$1`;
      params    = [req.params.id, req.user.username, d.note];
    } else if (d.action === 'cancel') {
      updateSQL = `SET status='cancelled', updated_at=NOW() WHERE id=$1`;
      params    = [req.params.id];
    } else if (d.action === 'reopen') {
      updateSQL = `SET status='draft', responded_at=NULL, responded_by=NULL, manager_note='', updated_at=NOW() WHERE id=$1`;
      params    = [req.params.id];
    }

    const r = await query(`UPDATE proformas ${updateSQL} RETURNING *`, params);
    const updated = rowToObj(r.rows[0]);
    res.json(updated);

    // Push Telegram notifications (non-blocking)
    try {
      const bot = require('../bot/telegram');
      if (d.action === 'send') {
        const msg = '📄 پیشفاکتور ' + updated.no + ' از ' + req.user.username +
          ' در انتظار تأیید است.\n💰 مبلغ: ' + Number(updated.total).toLocaleString('fa-IR') + ' ﷼\n👤 مشتری: ' + (updated.centerName || '—');
        bot.notifyManagers(msg).catch(function(){});
      } else if (d.action === 'approve' || d.action === 'reject') {
        const label = d.action === 'approve' ? '✅ تأیید شد' : '❌ رد شد';
        const msg   = '📄 پیشفاکتور ' + updated.no + ' ' + label + ' توسط ' + req.user.username +
          (d.note ? '\n📝 ' + d.note : '');
        bot.notifyAll(msg).catch(function(){});
      }
    } catch(e) {}
  } catch(e) {
    console.error('[proforma action]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── DELETE /api/proforma/:id ─────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const existing = await query('SELECT status FROM proformas WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    if (!['draft','cancelled'].includes(existing.rows[0].status)) {
      return res.status(400).json({ error: 'فقط پیش‌نویس یا لغو شده را می‌توان حذف کرد' });
    }
    await query('DELETE FROM proformas WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'خطای سرور' }); }
});

module.exports = router;
