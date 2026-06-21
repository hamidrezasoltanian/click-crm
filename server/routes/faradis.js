'use strict';

const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../auth');
const faradis = require('../integrations/faradis');

const router = express.Router();

function requireSuperAdmin(req, res, next) {
  if (req.user && req.user.role === 'سوپر ادمین') return next();
  return res.status(403).json({ error: 'فقط سوپر ادمین دسترسی دارد' });
}

function requireManager(req, res, next) {
  const role = req.user && req.user.role;
  if (role === 'مدیر' || role === 'سوپر ادمین') return next();
  return res.status(403).json({ error: 'فقط مدیر دسترسی دارد' });
}

// GET /api/faradis/status — connection test
router.get('/status', requireAuth, requireManager, async (req, res) => {
  if (!faradis.isConfigured()) {
    return res.json({ connected: false, message: 'اتصال به فرادیس پیکربندی نشده است' });
  }
  try {
    const info = await faradis.testConnection();
    res.json({ connected: true, serverTime: info.now, version: (info.ver || '').slice(0, 80) });
  } catch (e) {
    res.json({ connected: false, message: e.message });
  }
});

// POST /api/faradis/sync/:month — sync a Jalali month from Faradis to cache
// month format: YYYY-MM (e.g. 1403-01)
router.post('/sync/:month', requireAuth, requireSuperAdmin, async (req, res) => {
  const monthParam = req.params.month; // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(monthParam)) {
    return res.status(400).json({ error: 'فرمت ماه باید YYYY-MM باشد' });
  }
  const jalaliMonth = monthParam.replace('-', '/'); // YYYY/MM

  if (!faradis.isConfigured()) {
    return res.status(503).json({ error: 'اتصال به فرادیس پیکربندی نشده است' });
  }

  try {
    // Build marketer→username map from DB
    const mapRows = await query(`SELECT marketer_num, visitor_num, crm_username FROM faradis_marketer_map`);
    const marketerMap = {};
    const visitorMap = {};
    for (const r of mapRows.rows) {
      if (r.marketer_num) marketerMap[String(r.marketer_num)] = r.crm_username;
      if (r.visitor_num) visitorMap[String(r.visitor_num)] = r.crm_username;
    }

    const rows = await faradis.fetchSalesByMonth(jalaliMonth);
    let inserted = 0;

    for (const row of rows) {
      const mNum = String(row.MarketerNum || '');
      const vNum = String(row.VisitorNum || '');
      const crmUser = marketerMap[mNum] || visitorMap[vNum] || null;
      const dateStr = String(row.FactorDate || '');
      const monthKey = dateStr.length >= 6 ? dateStr.slice(0,4) + '/' + dateStr.slice(4,6) : jalaliMonth;

      await query(`
        INSERT INTO faradis_sales_cache
          (factor_id, factor_num, factor_date, jalali_month, marketer_num, visitor_num,
           crm_username, company_id, company_name, company_code,
           total_amount, sub_total, discount, tax, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (factor_id) DO UPDATE SET
          crm_username = EXCLUDED.crm_username,
          total_amount = EXCLUDED.total_amount,
          sub_total    = EXCLUDED.sub_total,
          discount     = EXCLUDED.discount,
          tax          = EXCLUDED.tax,
          synced_at    = NOW()
      `, [
        row.FactorID, String(row.FactorNum || ''), row.FactorDate || null, monthKey,
        mNum || null, vNum || null, crmUser,
        row.CompanyID || null, row.CompanyName || null, row.CompanyCode || null,
        parseFloat(row.TotalAmount) || 0,
        parseFloat(row.SubTotal) || 0,
        parseFloat(row.Discount) || 0,
        parseFloat(row.Tax) || 0,
      ]);
      inserted++;
    }

    await query(`
      INSERT INTO faradis_sync_log (jalali_month, rows_fetched, rows_inserted, status, triggered_by)
      VALUES ($1,$2,$3,'ok',$4)
    `, [jalaliMonth, rows.length, inserted, req.user.username]);

    res.json({ ok: true, month: jalaliMonth, fetched: rows.length, inserted });
  } catch (e) {
    console.error('[faradis/sync]', e.message);
    await query(`
      INSERT INTO faradis_sync_log (jalali_month, rows_fetched, rows_inserted, status, error_msg, triggered_by)
      VALUES ($1,0,0,'error',$2,$3)
    `, [jalaliMonth, e.message, req.user.username]).catch(() => {});
    res.status(500).json({ error: e.message });
  }
});

// GET /api/faradis/sales?month=YYYY-MM — get cached sales for a month
router.get('/sales', requireAuth, requireManager, async (req, res) => {
  const monthParam = req.query.month || '';
  if (monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) {
    return res.status(400).json({ error: 'فرمت ماه باید YYYY-MM باشد' });
  }
  const jalaliMonth = monthParam ? monthParam.replace('-', '/') : null;

  try {
    let r;
    if (jalaliMonth) {
      r = await query(`
        SELECT crm_username, COUNT(*) AS invoice_count,
               COALESCE(SUM(total_amount),0) AS total_amount,
               COUNT(DISTINCT company_id) AS customer_count
        FROM faradis_sales_cache
        WHERE jalali_month = $1
        GROUP BY crm_username ORDER BY total_amount DESC
      `, [jalaliMonth]);
    } else {
      r = await query(`
        SELECT jalali_month, crm_username,
               COUNT(*) AS invoice_count,
               COALESCE(SUM(total_amount),0) AS total_amount
        FROM faradis_sales_cache
        GROUP BY jalali_month, crm_username
        ORDER BY jalali_month DESC, total_amount DESC
        LIMIT 200
      `);
    }

    const users = await query(`SELECT username, display_name FROM app_users`);
    const nameMap = {};
    users.rows.forEach(u => { nameMap[u.username] = u.display_name || u.username; });

    res.json({
      month: jalaliMonth,
      rows: r.rows.map(row => ({
        ...row,
        display_name: nameMap[row.crm_username] || row.crm_username || 'نامشخص',
        total_amount: parseFloat(row.total_amount) || 0,
        invoice_count: parseInt(row.invoice_count) || 0,
        customer_count: parseInt(row.customer_count) || 0,
      })),
    });
  } catch (e) {
    console.error('[faradis/sales]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// GET /api/faradis/trend?months=6 — multi-month trend from cache
router.get('/trend', requireAuth, requireManager, async (req, res) => {
  const months = Math.min(24, parseInt(req.query.months) || 6);
  try {
    const r = await query(`
      SELECT jalali_month, crm_username,
             COALESCE(SUM(total_amount),0) AS total_amount,
             COUNT(*) AS invoice_count
      FROM faradis_sales_cache
      GROUP BY jalali_month, crm_username
      ORDER BY jalali_month DESC
      LIMIT $1
    `, [months * 20]);

    const users = await query(`SELECT username, display_name FROM app_users`);
    const nameMap = {};
    users.rows.forEach(u => { nameMap[u.username] = u.display_name || u.username; });

    const allMonths = [...new Set(r.rows.map(row => row.jalali_month))].sort().reverse().slice(0, months);

    res.json({
      months: allMonths,
      rows: r.rows.filter(row => allMonths.includes(row.jalali_month)).map(row => ({
        ...row,
        display_name: nameMap[row.crm_username] || row.crm_username || 'نامشخص',
        total_amount: parseFloat(row.total_amount) || 0,
        invoice_count: parseInt(row.invoice_count) || 0,
      })),
    });
  } catch (e) {
    console.error('[faradis/trend]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// GET /api/faradis/map — get marketer→username mapping
router.get('/map', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`
      SELECT m.*, u.display_name
      FROM faradis_marketer_map m
      LEFT JOIN app_users u ON u.username = m.crm_username
      ORDER BY m.id
    `);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// POST /api/faradis/map — add/update marketer→username mapping
router.post('/map', requireAuth, requireSuperAdmin, async (req, res) => {
  const { marketer_num, visitor_num, crm_username, notes } = req.body;
  if (!crm_username) return res.status(400).json({ error: 'crm_username الزامی است' });

  try {
    await query(`
      INSERT INTO faradis_marketer_map (marketer_num, visitor_num, crm_username, notes, created_by)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (marketer_num, visitor_num) DO UPDATE SET
        crm_username = EXCLUDED.crm_username,
        notes = EXCLUDED.notes
    `, [marketer_num || null, visitor_num || null, crm_username, notes || null, req.user.username]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/faradis/map/:id
router.delete('/map/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    await query(`DELETE FROM faradis_marketer_map WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/faradis/sync-log — recent sync history
router.get('/sync-log', requireAuth, requireSuperAdmin, async (req, res) => {
  try {
    const r = await query(`
      SELECT * FROM faradis_sync_log ORDER BY synced_at DESC LIMIT 50
    `);
    res.json({ rows: r.rows });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

module.exports = router;
