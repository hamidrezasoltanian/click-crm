'use strict';

const express = require('express');
const multer = require('multer');
const { query } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// Store files in memory (no temp files on disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
});

// GET /api/files/list/:prodId — list files for a product (no data, metadata only)
router.get('/list/:prodId', requireAuth, async (req, res) => {
  const prodId = parseInt(req.params.prodId);
  if (isNaN(prodId)) return res.status(400).json({ error: 'شناسه محصول نامعتبر' });
  try {
    const r = await query(
      'SELECT id, filename, mime_type, file_size, uploaded_by, created_at FROM product_files WHERE prod_id = $1 ORDER BY created_at ASC',
      [prodId]
    );
    res.json({ files: r.rows });
  } catch (e) {
    console.error('[files/list]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// POST /api/files/upload/:prodId — upload one or more files
router.post('/upload/:prodId', requireAuth, upload.array('files', 20), async (req, res) => {
  const prodId = parseInt(req.params.prodId);
  if (isNaN(prodId)) return res.status(400).json({ error: 'شناسه محصول نامعتبر' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'فایلی ارسال نشده' });
  try {
    const inserted = [];
    for (const f of req.files) {
      const r = await query(
        `INSERT INTO product_files (prod_id, filename, mime_type, file_size, data, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, filename, mime_type, file_size, uploaded_by, created_at`,
        [prodId, f.originalname, f.mimetype, f.size, f.buffer, req.user.username]
      );
      inserted.push(r.rows[0]);
    }
    res.json({ ok: true, files: inserted });
  } catch (e) {
    console.error('[files/upload]', e.message);
    res.status(500).json({ error: 'خطای ذخیره فایل' });
  }
});

// GET /api/files/:id — stream file for preview or download
router.get('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'شناسه نامعتبر' });
  try {
    const r = await query('SELECT filename, mime_type, data FROM product_files WHERE id = $1', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'فایل یافت نشد' });
    const { filename, mime_type, data } = r.rows[0];
    const dl = req.query.dl === '1';
    res.setHeader('Content-Type', mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      (dl ? 'attachment' : 'inline') + '; filename*=UTF-8\'\'' + encodeURIComponent(filename)
    );
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(data);
  } catch (e) {
    console.error('[files/get]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// DELETE /api/files/:id — delete a file (password checked on client)
router.delete('/:id', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'شناسه نامعتبر' });
  try {
    const r = await query('DELETE FROM product_files WHERE id = $1 RETURNING id', [id]);
    if (!r.rows.length) return res.status(404).json({ error: 'فایل یافت نشد' });
    res.json({ ok: true });
  } catch (e) {
    console.error('[files/delete]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

module.exports = router;
