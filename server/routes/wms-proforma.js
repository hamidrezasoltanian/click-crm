'use strict';

const express = require('express');
const { query, pool } = require('../db');
const { requireAuth, requireManager } = require('../auth');
const { genId, nextTxnNo, nextWpfNo } = require('./_wms-helpers');

const router = express.Router();

const TRANSITIONS = {
  draft:    ['send', 'cancel'],
  sent:     ['approve', 'reject', 'cancel'],
  approved: ['issue-voucher', 'cancel'],
  rejected: ['reopen'],
  cancelled:['reopen'],
};

const MANAGER_ROLES = ['مدیر', 'سوپر ادمین'];

function rowToObj(r) {
  return {
    id:            r.id,
    no:            r.no,
    jalaliDate:    r.jalali_date,
    customerId:    r.customer_id,
    customerName:  r.customer_name,
    warehouseId:   r.warehouse_id,
    warehouseName: r.warehouse_name,
    items:         r.items || [],
    subtotal:      Number(r.subtotal),
    discountPct:   Number(r.discount_pct),
    discAmt:       Number(r.disc_amt),
    taxPct:        Number(r.tax_pct),
    taxAmt:        Number(r.tax_amt),
    total:         Number(r.total),
    note:          r.note,
    status:        r.status,
    exitTxnId:     r.exit_txn_id,
    managerNote:   r.manager_note,
    createdBy:     r.created_by,
    createdAt:     r.created_at,
    updatedAt:     r.updated_at,
    sentAt:        r.sent_at,
    respondedAt:   r.responded_at,
    respondedBy:   r.responded_by,
    parentId:      r.parent_id,
    rootId:        r.root_id || r.id,
    version:       r.version || 1,
    isLatest:      r.is_latest !== false,
    ownerAtApproval:          r.owner_at_approval || null,
    commissionPctSnapshot:    r.commission_pct_snapshot !== null && r.commission_pct_snapshot !== undefined ? Number(r.commission_pct_snapshot) : null,
    commissionAmountSnapshot: r.commission_amount_snapshot !== null && r.commission_amount_snapshot !== undefined ? Number(r.commission_amount_snapshot) : null,
  };
}

function calcTotals(items, discountPct, taxPct) {
  const subtotal = items.reduce(function(s, i) { return s + (Number(i.qty) * Number(i.unitPrice)); }, 0);
  const discAmt  = Math.round(subtotal * discountPct / 100);
  const taxAmt   = Math.round((subtotal - discAmt) * taxPct / 100);
  const total    = subtotal - discAmt + taxAmt;
  return { subtotal, discAmt, taxAmt, total };
}

// مسئول فعلی مرکز — همان زنجیره تشخیص مالک که در app اصلی استفاده می‌شود
// (center_edits override → centers_master استاتیک)
async function resolveCenterOwner(centerId) {
  if (!centerId) return '';
  try {
    const r = await query(`SELECT data->>'owner' AS owner FROM center_edits WHERE center_key = $1`, [centerId]);
    if (r.rows[0] && r.rows[0].owner) return r.rows[0].owner;
  } catch (e) {}
  try {
    const cm = await query(`SELECT data FROM centers_master WHERE key = 'CENTERS'`);
    const centers = (cm.rows[0] && cm.rows[0].data) || [];
    const c = Array.isArray(centers) ? centers.find(function(x) { return x.id === centerId; }) : null;
    if (c && c.owner) return c.owner;
  } catch (e) {}
  return '';
}

async function resolveCommissionPct(username) {
  if (!username) return 0;
  try {
    const r = await query(`SELECT commission_pct FROM app_users WHERE username = $1`, [username]);
    return r.rows[0] ? (Number(r.rows[0].commission_pct) || 0) : 0;
  } catch (e) { return 0; }
}

// موجودی فعلی لات‌ها را روی آیتم‌ها سوار می‌کند تا کمبود موجودی نسبت به تاریخ صدور پیشفاکتور مشخص شود
async function enrichStock(itemsList) {
  const lotIds = [];
  itemsList.forEach(function(items) {
    (items || []).forEach(function(i) { if (i.lotId) lotIds.push(i.lotId); });
  });
  if (!lotIds.length) return;
  const uniq = Array.from(new Set(lotIds));
  const r = await query(`SELECT id, qty FROM wms_lots WHERE id = ANY($1::text[])`, [uniq]);
  const map = {};
  r.rows.forEach(function(l) { map[l.id] = Number(l.qty); });
  itemsList.forEach(function(items, idx) {
    itemsList[idx] = (items || []).map(function(i) {
      if (!i.lotId || !(i.lotId in map)) return i;
      const stock = map[i.lotId];
      return Object.assign({}, i, { currentStock: stock, lowStock: stock < Number(i.qty) });
    });
  });
}

// ── GET /api/wms-proforma/receivables — مطالبات از پیشفاکتورهای تأییدشده ────
router.get('/receivables', requireAuth, async (req, res) => {
  try {
    const isManager = MANAGER_ROLES.includes(req.user.role);
    const conditions = [`status IN ('approved','voucher_issued')`, `is_latest = true`];
    const params = [];
    if (!isManager) { conditions.push(`created_by = $1`); params.push(req.user.username); }
    const rows = await query(
      `SELECT * FROM wms_proformas WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
      params
    );
    const ids = rows.rows.map(function(r) { return r.id; });
    let paidMap = {};
    if (ids.length) {
      const pr = await query(
        `SELECT proforma_id, SUM(amount)::bigint AS paid FROM wms_proforma_payments WHERE proforma_id = ANY($1::text[]) GROUP BY proforma_id`,
        [ids]
      );
      pr.rows.forEach(function(p) { paidMap[p.proforma_id] = Number(p.paid); });
    }
    const out = rows.rows.map(function(r) {
      const o = rowToObj(r);
      o.paid = paidMap[r.id] || 0;
      o.remaining = o.total - o.paid;
      return o;
    });
    res.json(out);
  } catch (e) {
    console.error('[wms-proforma receivables]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/wms-proforma/report/by-user ─────────────────────────────────────
router.get('/report/by-user', requireAuth, async (req, res) => {
  try {
    const isManager = MANAGER_ROLES.includes(req.user.role);
    const { user, from, to, allVersions } = req.query;
    const targetUser = isManager ? (user || null) : req.user.username;

    const conditions = [];
    const params = [];
    let idx = 1;
    if (targetUser) { conditions.push(`created_by = $${idx++}`); params.push(targetUser); }
    if (!allVersions) conditions.push('is_latest = true');
    if (from) { conditions.push(`jalali_date >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`jalali_date <= $${idx++}`); params.push(to); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await query(
      `SELECT * FROM wms_proformas ${where} ORDER BY created_by, root_id, version`,
      params
    );
    res.json(rows.rows.map(rowToObj));
  } catch (e) {
    console.error('[wms-proforma report/by-user]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/wms-proforma/report/by-product — گزارش فروش بر اساس کالا/دسته ──
router.get('/report/by-product', requireAuth, async (req, res) => {
  try {
    const { from, to, groupBy } = req.query;
    const conditions = [`p.status IN ('approved','voucher_issued')`, `p.is_latest = true`];
    const params = [];
    let idx = 1;
    if (from) { conditions.push(`p.jalali_date >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`p.jalali_date <= $${idx++}`); params.push(to); }
    const where = 'WHERE ' + conditions.join(' AND ');

    if (groupBy === 'category') {
      const sql = `
        SELECT COALESCE(wp.category, 'بدون دسته') AS label,
               SUM((item->>'qty')::numeric) AS total_qty,
               SUM((item->>'lineTotal')::numeric) AS total_amount
        FROM wms_proformas p, jsonb_array_elements(p.items) AS item
        LEFT JOIN wms_products wp ON wp.id = item->>'productId'
        ${where}
        GROUP BY wp.category
        ORDER BY total_amount DESC`;
      const r = await query(sql, params);
      res.json(r.rows.map(row => ({ label: row.label, totalQty: Number(row.total_qty || 0), totalAmount: Number(row.total_amount || 0) })));
    } else {
      const sql = `
        SELECT item->>'productId' AS product_id,
               MAX(item->>'productName') AS label,
               SUM((item->>'qty')::numeric) AS total_qty,
               SUM((item->>'lineTotal')::numeric) AS total_amount
        FROM wms_proformas p, jsonb_array_elements(p.items) AS item
        ${where}
        GROUP BY item->>'productId'
        ORDER BY total_amount DESC`;
      const r = await query(sql, params);
      res.json(r.rows.map(row => ({ label: row.label, totalQty: Number(row.total_qty || 0), totalAmount: Number(row.total_amount || 0) })));
    }
  } catch (e) {
    console.error('[wms-proforma report/by-product]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/wms-proforma ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, customer, createdBy, from, to, allVersions } = req.query;
    const isManager = MANAGER_ROLES.includes(req.user.role);
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status)   { conditions.push(`status = $${idx++}`);      params.push(status); }
    if (customer) { conditions.push(`customer_id = $${idx++}`); params.push(customer); }
    if (!allVersions) conditions.push('is_latest = true');
    if (from) { conditions.push(`jalali_date >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`jalali_date <= $${idx++}`); params.push(to); }
    if (!isManager) {
      conditions.push(`created_by = $${idx++}`); params.push(req.user.username);
    } else if (createdBy) {
      conditions.push(`created_by = $${idx++}`); params.push(createdBy);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await query(
      `SELECT * FROM wms_proformas ${where} ORDER BY created_at DESC LIMIT 300`,
      params
    );
    const objs = rows.rows.map(rowToObj);
    const itemsList = objs.map(function(o) { return o.items; });
    await enrichStock(itemsList);
    objs.forEach(function(o, i) { o.items = itemsList[i]; });
    res.json(objs);
  } catch (e) {
    console.error('[wms-proforma GET]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/wms-proforma — create ─────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const b = req.body;
    if (!b.items || !Array.isArray(b.items) || !b.items.length) {
      return res.status(400).json({ error: 'حداقل یک ردیف الزامی است' });
    }

    const discountPct = Number(b.discountPct) || 0;
    const taxPct      = Number(b.taxPct) !== undefined ? Number(b.taxPct) : 9;
    const items = b.items.map(function(i) {
      return {
        lotId:      i.lotId || '',
        productId:  i.productId || '',
        productName: i.productName || '',
        lotNo:      i.lotNo || '',
        qty:        Number(i.qty),
        unitPrice:  Number(i.unitPrice) || 0,
        lineTotal:  Number(i.qty) * (Number(i.unitPrice) || 0),
      };
    });

    const { subtotal, discAmt, taxAmt, total } = calcTotals(items, discountPct, taxPct);

    await client.query('BEGIN');
    const no = await nextWpfNo(client);
    const id = genId('wpf');

    const r = await client.query(
      `INSERT INTO wms_proformas
         (id,no,jalali_date,customer_id,customer_name,warehouse_id,warehouse_name,
          items,subtotal,discount_pct,disc_amt,tax_pct,tax_amt,total,
          note,status,created_by,created_at,updated_at,root_id,version,is_latest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16,NOW(),NOW(),$1,1,true)
       RETURNING *`,
      [
        id, no, b.jalaliDate || null,
        b.customerId || null, b.customerName || '',
        b.warehouseId || null, b.warehouseName || '',
        JSON.stringify(items), subtotal, discountPct, discAmt,
        taxPct, taxAmt, total,
        b.note || '', req.user.username,
      ]
    );
    await client.query('COMMIT');
    res.status(201).json(rowToObj(r.rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[wms-proforma POST]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  } finally {
    client.release();
  }
});

// ── GET /api/wms-proforma/:id ────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM wms_proformas WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    const obj = rowToObj(r.rows[0]);
    const itemsList = [obj.items];
    await enrichStock(itemsList);
    obj.items = itemsList[0];
    res.json(obj);
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/wms-proforma/:id/versions — تاریخچهٔ نسخه‌ها ────────────────────
router.get('/:id/versions', requireAuth, async (req, res) => {
  try {
    const cur = await query('SELECT id, root_id FROM wms_proformas WHERE id = $1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    const rootId = cur.rows[0].root_id || cur.rows[0].id;
    const r = await query('SELECT * FROM wms_proformas WHERE root_id = $1 ORDER BY version ASC', [rootId]);
    res.json(r.rows.map(rowToObj));
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── PUT /api/wms-proforma/:id — update draft ─────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const existing = await query('SELECT * FROM wms_proformas WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    if (existing.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'فقط پیش‌نویس قابل ویرایش است؛ برای ویرایش نسخه‌های ارسال‌شده از «ویرایش با نسخه جدید» استفاده کنید' });
    }

    const b = req.body;
    const pf = rowToObj(existing.rows[0]);
    const items = b.items ? b.items.map(function(i) {
      return {
        lotId: i.lotId || '', productId: i.productId || '', productName: i.productName || '',
        lotNo: i.lotNo || '', qty: Number(i.qty), unitPrice: Number(i.unitPrice) || 0,
        lineTotal: Number(i.qty) * (Number(i.unitPrice) || 0),
      };
    }) : pf.items;

    const discountPct = b.discountPct !== undefined ? Number(b.discountPct) : pf.discountPct;
    const taxPct      = b.taxPct      !== undefined ? Number(b.taxPct)      : pf.taxPct;
    const { subtotal, discAmt, taxAmt, total } = calcTotals(items, discountPct, taxPct);

    const r = await query(
      `UPDATE wms_proformas SET
         jalali_date=$1, customer_id=$2, customer_name=$3, warehouse_id=$4, warehouse_name=$5,
         items=$6, subtotal=$7, discount_pct=$8, disc_amt=$9, tax_pct=$10, tax_amt=$11, total=$12,
         note=$13, updated_at=NOW()
       WHERE id=$14 RETURNING *`,
      [
        b.jalaliDate !== undefined ? b.jalaliDate : pf.jalaliDate,
        b.customerId !== undefined ? b.customerId : pf.customerId,
        b.customerName !== undefined ? b.customerName : pf.customerName,
        b.warehouseId !== undefined ? b.warehouseId : pf.warehouseId,
        b.warehouseName !== undefined ? b.warehouseName : pf.warehouseName,
        JSON.stringify(items), subtotal, discountPct, discAmt, taxPct, taxAmt, total,
        b.note !== undefined ? b.note : pf.note,
        req.params.id,
      ]
    );
    res.json(rowToObj(r.rows[0]));
  } catch (e) {
    console.error('[wms-proforma PUT]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/wms-proforma/:id/revise — ایجاد نسخه جدید با حفظ نسخه قبلی ────
router.post('/:id/revise', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM wms_proformas WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    }
    const old = existing.rows[0];
    if (old.status === 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'پیش‌نویس را مستقیماً ویرایش کنید' });
    }

    const newId = genId('wpf');
    const newNo = await nextWpfNo(client);
    const rootId = old.root_id || old.id;
    const newVersion = (old.version || 1) + 1;

    const r = await client.query(
      `INSERT INTO wms_proformas
         (id,no,jalali_date,customer_id,customer_name,warehouse_id,warehouse_name,
          items,subtotal,discount_pct,disc_amt,tax_pct,tax_amt,total,
          note,status,created_by,created_at,updated_at,parent_id,root_id,version,is_latest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16,NOW(),NOW(),$17,$18,$19,true)
       RETURNING *`,
      [
        newId, newNo, old.jalali_date, old.customer_id, old.customer_name,
        old.warehouse_id, old.warehouse_name, JSON.stringify(old.items || []),
        old.subtotal, old.discount_pct, old.disc_amt, old.tax_pct, old.tax_amt, old.total,
        old.note, req.user.username, old.id, rootId, newVersion,
      ]
    );
    await client.query(`UPDATE wms_proformas SET is_latest = false WHERE id = $1`, [old.id]);
    await client.query('COMMIT');
    res.status(201).json(rowToObj(r.rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[wms-proforma revise]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  } finally {
    client.release();
  }
});

// ── POST /api/wms-proforma/:id/action — workflow ─────────────────────────────
router.post('/:id/action', requireAuth, async (req, res) => {
  try {
    const { action, note } = req.body;
    const isManager = MANAGER_ROLES.includes(req.user.role);

    const existing = await query('SELECT * FROM wms_proformas WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    const pf = existing.rows[0];

    const allowed = TRANSITIONS[pf.status] || [];
    if (!allowed.includes(action)) {
      return res.status(400).json({
        error: `عملیات '${action}' در وضعیت '${pf.status}' مجاز نیست`,
      });
    }

    let updateSQL = '';
    let params = [];

    if (action === 'send') {
      updateSQL = `SET status='sent', sent_at=NOW(), updated_at=NOW() WHERE id=$1`;
      params = [req.params.id];
    } else if (action === 'approve') {
      if (!isManager) return res.status(403).json({ error: 'فقط مدیر می‌تواند تأیید کند' });
      // مالک فعلی مرکز و درصد پورسانتش در لحظه تأیید snapshot می‌شود — تغییر بعدی مسئول مرکز این مقدار را تغییر نمی‌دهد
      const owner = await resolveCenterOwner(pf.customer_id);
      const commissionPct = await resolveCommissionPct(owner);
      const commissionAmt = Math.round(Number(pf.total) * commissionPct / 100);
      updateSQL = `SET status='approved', responded_at=NOW(), responded_by=$2, manager_note=$3,
                       owner_at_approval=$4, commission_pct_snapshot=$5, commission_amount_snapshot=$6,
                       updated_at=NOW() WHERE id=$1`;
      params = [req.params.id, req.user.username, note || '', owner, commissionPct, commissionAmt];
    } else if (action === 'reject') {
      if (!isManager) return res.status(403).json({ error: 'فقط مدیر می‌تواند رد کند' });
      updateSQL = `SET status='rejected', responded_at=NOW(), responded_by=$2, manager_note=$3, updated_at=NOW() WHERE id=$1`;
      params = [req.params.id, req.user.username, note || ''];
    } else if (action === 'cancel') {
      updateSQL = `SET status='cancelled', updated_at=NOW() WHERE id=$1`;
      params = [req.params.id];
    } else if (action === 'reopen') {
      updateSQL = `SET status='draft', responded_at=NULL, responded_by=NULL, manager_note='',
                       owner_at_approval=NULL, commission_pct_snapshot=NULL, commission_amount_snapshot=NULL,
                       updated_at=NOW() WHERE id=$1`;
      params = [req.params.id];
    }

    const r = await query(`UPDATE wms_proformas ${updateSQL} RETURNING *`, params);
    res.json(rowToObj(r.rows[0]));
  } catch (e) {
    console.error('[wms-proforma action]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/wms-proforma/:id/payments — ثبت پرداخت کامل یا جزئی ───────────
router.post('/:id/payments', requireAuth, async (req, res) => {
  try {
    const amt = Number(req.body.amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'مبلغ نامعتبر است' });

    const existing = await query('SELECT status FROM wms_proformas WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    if (!['approved', 'voucher_issued'].includes(existing.rows[0].status)) {
      return res.status(400).json({ error: 'فقط برای پیشفاکتور تأییدشده می‌توان پرداخت ثبت کرد' });
    }

    const id = genId('pay');
    const r = await query(
      `INSERT INTO wms_proforma_payments (id, proforma_id, amount, jalali_date, method, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, req.params.id, amt, req.body.jalaliDate || null, req.body.method || '', req.body.note || '', req.user.username]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('[wms-proforma payments POST]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/wms-proforma/:id/payments ───────────────────────────────────────
router.get('/:id/payments', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM wms_proforma_payments WHERE proforma_id = $1 ORDER BY created_at ASC', [req.params.id]);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/wms-proforma/:id/issue-voucher — atomic exit voucher ──────────
router.post('/:id/issue-voucher', requireManager, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Load proforma with lock
    const pfRes = await client.query(
      'SELECT * FROM wms_proformas WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    if (!pfRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    }
    const pf = pfRes.rows[0];
    if (pf.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'فقط پیشفاکتور تأیید شده قابل صدور حواله است' });
    }

    const items = pf.items || [];

    // Lock all lots and check qty
    const lotIds = items.map(function(i) { return i.lotId; }).filter(Boolean);
    if (!lotIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'هیچ لاتی در پیشفاکتور مشخص نشده' });
    }

    const lotsRes = await client.query(
      `SELECT * FROM wms_lots WHERE id = ANY($1::text[]) FOR UPDATE`,
      [lotIds]
    );
    const lotsMap = {};
    lotsRes.rows.forEach(function(l) { lotsMap[l.id] = l; });

    for (const item of items) {
      if (!item.lotId) continue;
      const lot = lotsMap[item.lotId];
      if (!lot) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `لات ${item.lotNo || item.lotId} یافت نشد` });
      }
      if (Number(lot.qty) < Number(item.qty)) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `موجودی لات ${lot.lot_no || item.lotNo} کافی نیست (موجود: ${lot.qty}، درخواست: ${item.qty})`,
        });
      }
    }

    // Create transactions + deduct lots
    const txnNo = await nextTxnNo(client, 'exit');
    let firstTxnId = null;

    for (const item of items) {
      if (!item.lotId) continue;
      const txnId = genId('tx');
      if (!firstTxnId) firstTxnId = txnId;

      await client.query(
        `INSERT INTO wms_transactions
           (id,txn_no,type,txn_type,product_id,lot_id,warehouse_id,qty,
            sale_price,counterparty_id,by_user,txn_date,status,note,ref_no)
         VALUES ($1,$2,'exit','sale',$3,$4,$5,$6,$7,$8,$9,NOW(),'approved',$10,$11)`,
        [
          txnId, txnNo,
          item.productId || null,
          item.lotId,
          pf.warehouse_id || null,
          Number(item.qty),
          Number(item.unitPrice) || 0,
          pf.customer_id || null,
          req.user.username,
          req.body.note || '',
          pf.no,
        ]
      );

      await client.query(
        `UPDATE wms_lots SET qty = qty - $1, updated_at = NOW() WHERE id = $2`,
        [Number(item.qty), item.lotId]
      );
    }

    // Mark proforma as voucher_issued
    const r = await client.query(
      `UPDATE wms_proformas SET status='voucher_issued', exit_txn_id=$1, updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [firstTxnId, req.params.id]
    );

    await client.query('COMMIT');
    res.json(rowToObj(r.rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[wms-proforma issue-voucher]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  } finally {
    client.release();
  }
});

// ── DELETE /api/wms-proforma/:id — delete draft/cancelled ───────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const existing = await query('SELECT status FROM wms_proformas WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'پیشفاکتور یافت نشد' });
    if (!['draft', 'cancelled'].includes(existing.rows[0].status)) {
      return res.status(400).json({ error: 'فقط پیش‌نویس یا لغو شده را می‌توان حذف کرد' });
    }
    await query('DELETE FROM wms_proformas WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

module.exports = router;
