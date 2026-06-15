'use strict';

const express   = require('express');
const { z }     = require('zod');
const { query } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// ════════════════════════════════════════════════════════════════════════════
// BACKWARD-COMPATIBLE BLOB ENDPOINTS
// wms.html still uses loadS() / saveS() which GET/PUT the full S object.
// These endpoints reconstruct/decompose the blob from/to SQL tables.
// Future: replace with per-entity endpoints as frontend is migrated.
// ════════════════════════════════════════════════════════════════════════════

// ── GET /api/wms — reconstruct full S object from SQL ───────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const [products, warehouses, counterparties, lots, transactions, purchaseOrders, recalls] =
      await Promise.all([
        query('SELECT * FROM wms_products ORDER BY name'),
        query('SELECT * FROM wms_warehouses ORDER BY name'),
        query('SELECT * FROM wms_counterparties ORDER BY name'),
        query('SELECT * FROM wms_lots ORDER BY created_at'),
        query('SELECT * FROM wms_transactions ORDER BY txn_date DESC'),
        query('SELECT * FROM wms_purchase_orders ORDER BY created_at DESC'),
        query('SELECT * FROM wms_recalls ORDER BY created_at DESC'),
      ]);

    // Load settings (printConfig, priceLists, priceItems, seq, etc.)
    const settingsRows = await query('SELECT key, value FROM wms_settings');
    const settings = {};
    settingsRows.rows.forEach(function(r){ settings[r.key] = r.value; });

    const S = {
      seq:           settings.seq           || { entry:1000, exit:2000, count:3000, po:1000, priceItem:100, recall:100 },
      printConfig:   settings.printConfig   || _defaultPrintConfig(),
      priceLists:    settings.priceLists    || [],
      priceItems:    settings.priceItems    || [],
      priceHistory:  settings.priceHistory  || [],
      stockCounts:   settings.stockCounts   || [],
      reconciliations: settings.reconciliations || [],
      auditLog:      [],  // served separately, don't bloat S
      users:         [],  // injected from CRM users in wms.html

      products: products.rows.map(_prodRow),
      warehouses: warehouses.rows.map(_whRow),
      counterparties: counterparties.rows.map(_cpRow),
      lots:         lots.rows.map(_lotRow),
      transactions: transactions.rows.map(_txnRow),
      purchaseOrders: purchaseOrders.rows.map(_poRow),
      recalls:      recalls.rows.map(_recallRow),
    };

    res.json(S);
  } catch(e) {
    console.error('[wms GET]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── PUT /api/wms — decompose S object → SQL upserts ─────────────────────────
router.put('/', requireAuth, async (req, res) => {
  try {
    const S = req.body;
    if (!S || typeof S !== 'object') {
      return res.status(400).json({ error: 'داده نامعتبر' });
    }

    // Use a transaction for atomicity
    const client = await require('../db').pool.connect();
    try {
      await client.query('BEGIN');

      // products
      for (const p of (S.products || [])) {
        await client.query(
          `INSERT INTO wms_products (id,name,full_name,brand,size,catalog_code,irc_code,unit,category,reorder_point,note,active,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
           ON CONFLICT (id) DO UPDATE SET
             name=$2,full_name=$3,brand=$4,size=$5,catalog_code=$6,irc_code=$7,
             unit=$8,category=$9,reorder_point=$10,note=$11,active=$12,updated_at=NOW()`,
          [p.id,p.name||'',p.fullName||'',p.brand||'',p.size||'',
           p.catalogCode||'',p.ircCode||'',p.unit||'عدد',p.category||'',
           p.reorderPoint||10,p.note||'',p.active!==false]
        );
      }
      // warehouses
      for (const w of (S.warehouses || [])) {
        await client.query(
          `INSERT INTO wms_warehouses (id,name,location,manager_id,note,active)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET name=$2,location=$3,manager_id=$4,note=$5,active=$6`,
          [w.id,w.name||'',w.location||'',w.managerId||'',w.note||'',w.active!==false]
        );
      }
      // counterparties
      for (const c of (S.counterparties || [])) {
        const t = ['supplier','customer','both'].includes(c.type) ? c.type : 'both';
        await client.query(
          `INSERT INTO wms_counterparties (id,name,type,phone,address,tax_code,email,note,active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET name=$2,type=$3,phone=$4,address=$5,tax_code=$6,email=$7,note=$8,active=$9`,
          [c.id,c.name||'',t,c.phone||'',c.address||'',c.taxCode||'',c.email||'',c.note||'',c.active!==false]
        );
      }
      // lots
      for (const l of (S.lots || [])) {
        await client.query(
          `INSERT INTO wms_lots (id,product_id,warehouse_id,lot_no,qty,expiry,purchase_price,
             counterparty_id,txn_id,lot_date,entered_by,approved_by,ttac_no,imed_status,imed_ref_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT (id) DO UPDATE SET
             qty=$5,ttac_no=$13,imed_status=$14,imed_ref_no=$15`,
          [l.id,l.productId||null,l.warehouseId||null,l.lotNo||'',l.qty||0,
           l.expiry||null,l.purchasePrice||0,l.counterpartyId||null,l.txnId||null,
           l.date||null,l.enteredBy||null,l.approvedBy||null,
           l.ttacNo||'',l.imedStatus||'not_registered',l.imedRefNo||'']
        );
      }
      // transactions
      for (const t of (S.transactions || [])) {
        await client.query(
          `INSERT INTO wms_transactions
             (id,txn_no,type,txn_type,product_id,lot_id,warehouse_id,qty,unit_price,sale_price,
              counterparty_id,from_warehouse_id,to_warehouse_id,by_user,txn_date,status,note,
              ref_no,imed_status,imed_ref_no,imed_date,ttac_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
           ON CONFLICT (id) DO UPDATE SET status=$16,note=$17,imed_status=$19,imed_ref_no=$20,imed_date=$21,ttac_no=$22`,
          [t.id,t.txnNo||null,t.type||'entry',t.txnType||'',
           t.productId||null,t.lotId||null,t.warehouseId||null,
           t.qty||0,t.unitPrice||0,t.salePrice||0,t.counterpartyId||null,
           t.fromWarehouseId||null,t.toWarehouseId||null,t.by||null,
           t.date||new Date(),t.status||'pending',t.note||'',
           t.refNo||'',t.imedStatus||'not_registered',t.imedRefNo||'',t.imedDate||'',t.ttacNo||'']
        );
      }
      // purchase orders
      for (const po of (S.purchaseOrders || [])) {
        await client.query(
          `INSERT INTO wms_purchase_orders (id,po_no,supplier_id,warehouse_id,requested_by,
             approved_by,approved_at,status,items,po_date,expected_delivery,note,imed_status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (id) DO UPDATE SET
             status=$8,items=$9,approved_by=$6,approved_at=$7,note=$12,imed_status=$13`,
          [po.id,po.poNo||null,po.supplierId||null,po.warehouseId||null,
           po.requestedBy||null,po.approvedBy||null,po.approvedAt||null,
           po.status||'draft',JSON.stringify(po.items||[]),
           po.date||null,po.expectedDelivery||null,po.note||'',
           po.imedStatus||'not_registered']
        );
      }
      // settings (printConfig, priceLists, priceItems, seq, etc.)
      const settingsKeys = ['printConfig','priceLists','priceItems','priceHistory','seq','stockCounts','reconciliations'];
      for (const k of settingsKeys) {
        if (S[k] !== undefined) {
          await client.query(
            `INSERT INTO wms_settings (key,value,updated_at) VALUES ($1,$2,NOW())
             ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
            [k, JSON.stringify(S[k])]
          );
        }
      }

      await client.query('COMMIT');
      res.json({ ok: true });
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch(e) {
    console.error('[wms PUT]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PROPER REST API — used by bot, reports, future Vue frontend
// ════════════════════════════════════════════════════════════════════════════

// GET /api/wms/inventory — aggregated stock per product (fast query)
router.get('/inventory', requireAuth, async (req, res) => {
  try {
    const rows = await query(`
      SELECT
        p.id, p.name, p.full_name, p.unit, p.reorder_point,
        COALESCE(SUM(l.qty), 0)::int AS total_qty,
        COUNT(l.id)::int AS lot_count,
        MIN(l.expiry) AS nearest_expiry
      FROM wms_products p
      LEFT JOIN wms_lots l ON l.product_id = p.id AND l.qty > 0
      WHERE p.active = true
      GROUP BY p.id, p.name, p.full_name, p.unit, p.reorder_point
      ORDER BY p.name
    `);
    res.json(rows.rows);
  } catch(e) {
    console.error('[wms/inventory]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// GET /api/wms/lots/scan/:code — QR/lot code lookup (used by bot)
router.get('/lots/scan/:code', requireAuth, async (req, res) => {
  try {
    const code = req.params.code;
    const r = await query(
      `SELECT l.*, p.name AS product_name, p.full_name, p.unit,
              p.catalog_code, p.irc_code, w.name AS warehouse_name
       FROM wms_lots l
       JOIN wms_products p ON p.id = l.product_id
       LEFT JOIN wms_warehouses w ON w.id = l.warehouse_id
       WHERE l.lot_no = $1 OR l.id = $1
       LIMIT 1`,
      [code]
    );
    if (!r.rows.length) {
      // Try product lookup
      const pr = await query(
        `SELECT p.*,
                COALESCE(SUM(l.qty),0)::int AS total_qty
         FROM wms_products p
         LEFT JOIN wms_lots l ON l.product_id = p.id
         WHERE p.catalog_code=$1 OR p.irc_code=$1 OR p.id=$1
         GROUP BY p.id LIMIT 1`,
        [code]
      );
      if (!pr.rows.length) return res.status(404).json({ error: 'کد یافت نشد' });
      return res.json({ type: 'product', data: pr.rows[0] });
    }
    return res.json({ type: 'lot', data: r.rows[0] });
  } catch(e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// GET /api/wms/transactions — paginated
router.get('/transactions', requireAuth, async (req, res) => {
  try {
    const { type, product, from, to, status, limit = 50, offset = 0 } = req.query;
    const conditions = [];
    const params     = [];
    let idx = 1;

    if (type)    { conditions.push(`t.type = $${idx++}`);       params.push(type); }
    if (product) { conditions.push(`t.product_id = $${idx++}`); params.push(product); }
    if (status)  { conditions.push(`t.status = $${idx++}`);     params.push(status); }
    if (from)    { conditions.push(`t.txn_date >= $${idx++}`);  params.push(from); }
    if (to)      { conditions.push(`t.txn_date <= $${idx++}`);  params.push(to + ' 23:59:59'); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(Math.min(parseInt(limit)||50, 200));
    params.push(parseInt(offset)||0);

    const rows = await query(
      `SELECT t.*, p.name AS product_name, w.name AS warehouse_name, cp.name AS counterparty_name
       FROM wms_transactions t
       LEFT JOIN wms_products p ON p.id = t.product_id
       LEFT JOIN wms_warehouses w ON w.id = t.warehouse_id
       LEFT JOIN wms_counterparties cp ON cp.id = t.counterparty_id
       ${where}
       ORDER BY t.txn_date DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      params
    );
    res.json(rows.rows);
  } catch(e) {
    console.error('[wms/transactions]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── Row mappers (SQL → JS camelCase) ─────────────────────────────────────────
function _prodRow(r) {
  return { id:r.id, name:r.name, fullName:r.full_name, brand:r.brand, size:r.size,
           catalogCode:r.catalog_code, ircCode:r.irc_code, unit:r.unit,
           category:r.category, reorderPoint:r.reorder_point, note:r.note, active:r.active };
}
function _whRow(r) {
  return { id:r.id, name:r.name, location:r.location, managerId:r.manager_id, note:r.note, active:r.active };
}
function _cpRow(r) {
  return { id:r.id, name:r.name, type:r.type, phone:r.phone, address:r.address,
           taxCode:r.tax_code, email:r.email, note:r.note, active:r.active };
}
function _lotRow(r) {
  return { id:r.id, productId:r.product_id, warehouseId:r.warehouse_id, lotNo:r.lot_no,
           qty:Number(r.qty), expiry:r.expiry?r.expiry.toISOString().split('T')[0]:null,
           purchasePrice:Number(r.purchase_price), counterpartyId:r.counterparty_id,
           txnId:r.txn_id, date:r.lot_date, enteredBy:r.entered_by, approvedBy:r.approved_by,
           ttacNo:r.ttac_no, imedStatus:r.imed_status, imedRefNo:r.imed_ref_no };
}
function _txnRow(r) {
  return { id:r.id, txnNo:r.txn_no, type:r.type, txnType:r.txn_type,
           productId:r.product_id, lotId:r.lot_id, warehouseId:r.warehouse_id,
           qty:Number(r.qty), unitPrice:Number(r.unit_price), salePrice:Number(r.sale_price),
           counterpartyId:r.counterparty_id, fromWarehouseId:r.from_warehouse_id,
           toWarehouseId:r.to_warehouse_id, by:r.by_user,
           date:r.txn_date, status:r.status, note:r.note, refNo:r.ref_no,
           imedStatus:r.imed_status, imedRefNo:r.imed_ref_no, imedDate:r.imed_date,
           ttacNo:r.ttac_no };
}
function _poRow(r) {
  return { id:r.id, poNo:r.po_no, supplierId:r.supplier_id, warehouseId:r.warehouse_id,
           requestedBy:r.requested_by, approvedBy:r.approved_by, approvedAt:r.approved_at,
           status:r.status, items:r.items, date:r.po_date, expectedDelivery:r.expected_delivery,
           note:r.note, imedStatus:r.imed_status };
}
function _recallRow(r) {
  return { id:r.id, lotId:r.lot_id, productId:r.product_id, severity:r.severity,
           status:r.status, description:r.description, affectedQty:r.affected_qty,
           action:r.action, resolvedAt:r.resolved_at, createdBy:r.created_by };
}
function _defaultPrintConfig() {
  return { companyName:'آتنا زیست درمان', companySub:'توزیع‌کننده تجهیزات پزشکی',
           entryTitle:'رسید ورود کالا', exitTitle:'حواله خروج کالا',
           showQR:true, showCompanyLogo:true, showBrand:true, showSize:true,
           showCatalogCode:true, showIRC:true, showLot:true, showExpiry:true,
           showUnitPrice:true, showTotal:true, showNote:true,
           showMetaRef:true, showMetaWh:true, showMetaRegistrar:true, showMetaPhone:true,
           showSig:true, sig1Name:'', sig1Role:'تأییدکننده', sig2Name:'', sig2Role:'مدیر',
           sig3Name:'', sig3Role:'انباردار', footer:'', fontSize:12 };
}

module.exports = router;
