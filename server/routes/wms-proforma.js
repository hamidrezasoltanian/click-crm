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
  };
}

function calcTotals(items, discountPct, taxPct) {
  const subtotal = items.reduce(function(s, i) { return s + (Number(i.qty) * Number(i.unitPrice)); }, 0);
  const discAmt  = Math.round(subtotal * discountPct / 100);
  const taxAmt   = Math.round((subtotal - discAmt) * taxPct / 100);
  const total    = subtotal - discAmt + taxAmt;
  return { subtotal, discAmt, taxAmt, total };
}

// ── GET /api/wms-proforma ────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, customer } = req.query;
    const isManager = ['مدیر', 'سوپر ادمین'].includes(req.user.role);
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status)   { conditions.push(`status = $${idx++}`);      params.push(status); }
    if (customer) { conditions.push(`customer_id = $${idx++}`); params.push(customer); }
    if (!isManager) { conditions.push(`created_by = $${idx++}`); params.push(req.user.username); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await query(
      `SELECT * FROM wms_proformas ${where} ORDER BY created_at DESC LIMIT 300`,
      params
    );
    res.json(rows.rows.map(rowToObj));
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
          note,status,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',$16,NOW(),NOW())
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
    res.json(rowToObj(r.rows[0]));
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
      return res.status(400).json({ error: 'فقط پیش‌نویس قابل ویرایش است' });
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

// ── POST /api/wms-proforma/:id/action — workflow ─────────────────────────────
router.post('/:id/action', requireAuth, async (req, res) => {
  try {
    const { action, note } = req.body;
    const isManager = ['مدیر', 'سوپر ادمین'].includes(req.user.role);

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
      updateSQL = `SET status='approved', responded_at=NOW(), responded_by=$2, manager_note=$3, updated_at=NOW() WHERE id=$1`;
      params = [req.params.id, req.user.username, note || ''];
    } else if (action === 'reject') {
      if (!isManager) return res.status(403).json({ error: 'فقط مدیر می‌تواند رد کند' });
      updateSQL = `SET status='rejected', responded_at=NOW(), responded_by=$2, manager_note=$3, updated_at=NOW() WHERE id=$1`;
      params = [req.params.id, req.user.username, note || ''];
    } else if (action === 'cancel') {
      updateSQL = `SET status='cancelled', updated_at=NOW() WHERE id=$1`;
      params = [req.params.id];
    } else if (action === 'reopen') {
      updateSQL = `SET status='draft', responded_at=NULL, responded_by=NULL, manager_note='', updated_at=NOW() WHERE id=$1`;
      params = [req.params.id];
    }

    const r = await query(`UPDATE wms_proformas ${updateSQL} RETURNING *`, params);
    res.json(rowToObj(r.rows[0]));
  } catch (e) {
    console.error('[wms-proforma action]', e.message);
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
