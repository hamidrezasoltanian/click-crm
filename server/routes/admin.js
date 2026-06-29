'use strict';
const router = require('express').Router();
const { query } = require('../db');
const { requireAuth, requireManager } = require('../auth');

router.use(requireAuth, requireManager);

// GET /api/admin/workflows?entity_type=...
router.get('/workflows', async (req, res) => {
  try {
    const { entity_type } = req.query;
    let sql = `SELECT id, entity_type, name, is_active, created_by, created_at, updated_at FROM workflows`;
    const params = [];
    if (entity_type) { sql += ` WHERE entity_type = $1`; params.push(entity_type); }
    sql += ` ORDER BY entity_type, name`;
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (e) {
    console.error('[admin/workflows GET]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/admin/workflows/:id
router.get('/workflows/:id', async (req, res) => {
  try {
    const r = await query(`SELECT * FROM workflows WHERE id = $1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/workflows
router.post('/workflows', async (req, res) => {
  try {
    const { entity_type, name, definition } = req.body;
    if (!entity_type || !name) return res.status(400).json({ error: 'entity_type and name required' });
    const id = 'wf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const def = definition || { states: [], transitions: [] };
    await query(
      `INSERT INTO workflows (id, entity_type, name, definition, created_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, entity_type, name, JSON.stringify(def), req.user.username]
    );
    res.json({ id });
  } catch (e) {
    console.error('[admin/workflows POST]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/admin/workflows/:id
router.put('/workflows/:id', async (req, res) => {
  try {
    const { name, definition } = req.body;
    const r = await query(
      `UPDATE workflows SET name=$1, definition=$2, updated_at=NOW() WHERE id=$3 RETURNING id`,
      [name, JSON.stringify(definition), req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/workflows/:id/activate
router.post('/workflows/:id/activate', async (req, res) => {
  try {
    const r = await query(`SELECT entity_type FROM workflows WHERE id=$1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Not found' });
    const et = r.rows[0].entity_type;
    await query(`UPDATE workflows SET is_active=false WHERE entity_type=$1`, [et]);
    await query(`UPDATE workflows SET is_active=true, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/workflows/:id/deactivate
router.post('/workflows/:id/deactivate', async (req, res) => {
  try {
    await query(`UPDATE workflows SET is_active=false, updated_at=NOW() WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/admin/workflows/:id
router.delete('/workflows/:id', async (req, res) => {
  try {
    const r = await query(`DELETE FROM workflows WHERE id=$1 AND is_active=false RETURNING id`, [req.params.id]);
    if (!r.rows[0]) return res.status(400).json({ error: 'برای حذف ابتدا ورک‌فلو را غیرفعال کنید' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
