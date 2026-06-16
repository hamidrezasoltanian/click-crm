'use strict';

const express = require('express');
const { query } = require('../db');
const { requireManager } = require('../auth');

const router = express.Router();

// POST /api/migrate/blob-to-sql
// Manager-only: migrate tasks, weekEntries, notifications, changeLog from blob → SQL tables
router.post('/blob-to-sql', requireManager, async (req, res) => {
  try {
    const result = await _migrateBlobToSQL();
    return res.json({ ok: true, migrated: result });
  } catch (e) {
    console.error('[migrate/blob-to-sql]', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Core migration logic — shared between the API endpoint and the CLI script.
 * Returns a summary object: { tasks, weekEntries, notifications, changeLog, skipped }
 */
async function _migrateBlobToSQL() {
  // 1. Load the current main blob
  const blobRes = await query("SELECT value FROM app_data WHERE key = 'main'");
  if (!blobRes.rows.length || !blobRes.rows[0].value) {
    throw new Error('app_data blob (key=main) not found or empty');
  }
  const blob = blobRes.rows[0].value;

  const summary = { tasks: 0, weekEntries: 0, notifications: 0, changeLog: 0, skipped: 0 };

  // ── TASKS ──────────────────────────────────────────────────────────────────
  const blobTasks = Array.isArray(blob.tasks) ? blob.tasks : [];
  for (const t of blobTasks) {
    if (!t || !t.id) { summary.skipped++; continue; }
    const r = await query(
      `INSERT INTO tasks
         (id, title, owner, due_date, priority, status, center_key, note,
          subtasks, done, done_at, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO NOTHING`,
      [
        t.id,
        t.title || '',
        t.owner || null,
        t.dueDate || null,
        t.priority != null ? t.priority : 2,
        t.status || 'todo',
        t.centerKey || null,
        t.note || '',
        JSON.stringify(t.subtasks || []),
        t.done === true,
        t.doneAt || null,
        t.createdBy || null,
        t.createdAt || new Date().toISOString(),
        t.updatedAt || t.createdAt || new Date().toISOString(),
      ]
    );
    if (r.rowCount > 0) summary.tasks++;
    else summary.skipped++;
  }

  // ── WEEK ENTRIES ───────────────────────────────────────────────────────────
  // blob.weekEntries is an object: { "weekId:::recKey": { rtype, rid, ... } }
  const blobWE = (blob.weekEntries && typeof blob.weekEntries === 'object') ? blob.weekEntries : {};
  for (const [compositeKey, we] of Object.entries(blobWE)) {
    if (!we || typeof we !== 'object') { summary.skipped++; continue; }

    const sepIdx = compositeKey.indexOf(':::');
    if (sepIdx === -1) { summary.skipped++; continue; }
    const weekId = compositeKey.slice(0, sepIdx);
    const recKey = compositeKey.slice(sepIdx + 3);

    // Check if a (week_id, rec_key) combo already exists — avoid double-insert
    const existing = await query(
      'SELECT id FROM week_entries WHERE week_id = $1 AND rec_key = $2 LIMIT 1',
      [weekId, recKey]
    );
    if (existing.rows.length > 0) { summary.skipped++; continue; }

    // Generate a stable id from the composite key using base64
    const id = 'we_' + Buffer.from(compositeKey).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);

    const r = await query(
      `INSERT INTO week_entries
         (id, week_id, rec_key, rtype, rid, scheduled_date, action_type,
          done, done_date, added_by, center_name, week_tag_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        id,
        weekId,
        recKey,
        we.rtype || 'center',
        we.rid || recKey,
        we.scheduledDate || null,
        we.actionType || 'call',
        we.done === true,
        we.doneDate || null,
        we.addedBy || null,
        we.centerName || null,
        we.weekTagId || null,
      ]
    );
    if (r.rowCount > 0) summary.weekEntries++;
    else summary.skipped++;
  }

  // ── NOTIFICATIONS ──────────────────────────────────────────────────────────
  const blobNotifs = Array.isArray(blob.notifications) ? blob.notifications : [];
  for (const n of blobNotifs) {
    if (!n || !n.id) { summary.skipped++; continue; }
    const r = await query(
      `INSERT INTO notifications (id, to_user, msg, center_key, at, read)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [
        n.id,
        n.to || '',
        n.msg || '',
        n.centerKey || null,
        n.at || new Date().toISOString(),
        n.read === true,
      ]
    );
    if (r.rowCount > 0) summary.notifications++;
    else summary.skipped++;
  }

  // ── CHANGE LOG ─────────────────────────────────────────────────────────────
  // change_log uses BIGSERIAL id — no blob id to preserve.
  // Skip entirely if the table already has data (idempotency).
  const clCount = await query('SELECT COUNT(*) FROM change_log');
  const existingClRows = parseInt(clCount.rows[0].count, 10);
  if (existingClRows > 0) {
    console.log('[migrate] change_log already has ' + existingClRows + ' rows — skipping changeLog migration');
    summary.skipped += Array.isArray(blob.changeLog) ? blob.changeLog.length : 0;
  } else {
    const blobCL = Array.isArray(blob.changeLog) ? blob.changeLog : [];
    for (const entry of blobCL) {
      if (!entry || !entry.at || !entry.by || !entry.rkey || !entry.field) {
        summary.skipped++; continue;
      }
      await query(
        `INSERT INTO change_log (at, by, rkey, field, val)
         VALUES ($1,$2,$3,$4,$5)`,
        [
          entry.at,
          entry.by,
          entry.rkey,
          entry.field,
          entry.val !== undefined ? JSON.stringify(entry.val) : null,
        ]
      );
      summary.changeLog++;
    }
  }

  return summary;
}

module.exports = router;
module.exports._migrateBlobToSQL = _migrateBlobToSQL;
