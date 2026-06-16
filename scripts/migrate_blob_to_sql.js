#!/usr/bin/env node
'use strict';

// One-shot CLI script: migrate tasks, weekEntries, notifications, changeLog
// from the app_data JSON blob → proper SQL tables.
//
// Run with: node scripts/migrate_blob_to_sql.js
//
// Safe to run multiple times — all inserts use ON CONFLICT DO NOTHING,
// and changeLog migration is skipped if the table already has rows.

// Load .env manually (mirrors server/index.js approach — no dotenv dependency needed)
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(function (line) {
      const m = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    });
  }
} catch (e) {}

// Re-use the shared db module so we get the same pool config as the server
const { query, pool } = require('../server/db');

async function main() {
  console.log('[migrate] Starting blob → SQL migration...');

  // 1. Load the current main blob
  let blob;
  try {
    const blobRes = await query("SELECT value FROM app_data WHERE key = 'main'");
    if (!blobRes.rows.length || !blobRes.rows[0].value) {
      console.error('[migrate] ERROR: app_data blob (key=main) not found or empty');
      process.exit(1);
    }
    blob = blobRes.rows[0].value;
    console.log('[migrate] Blob loaded successfully');
  } catch (e) {
    console.error('[migrate] ERROR loading blob:', e.message);
    process.exit(1);
  }

  const summary = { tasks: 0, weekEntries: 0, notifications: 0, changeLog: 0, skipped: 0 };

  // ── TASKS ────────────────────────────────────────────────────────────────
  const blobTasks = Array.isArray(blob.tasks) ? blob.tasks : [];
  console.log('[migrate] Tasks in blob: ' + blobTasks.length);
  for (const t of blobTasks) {
    if (!t || !t.id) { summary.skipped++; continue; }
    try {
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
    } catch (e) {
      console.error('[migrate] Task insert error (id=' + t.id + '):', e.message);
      summary.skipped++;
    }
  }
  console.log('[migrate] Tasks migrated: ' + summary.tasks + ' (skipped: ' + summary.skipped + ')');

  // ── WEEK ENTRIES ─────────────────────────────────────────────────────────
  const blobWE = (blob.weekEntries && typeof blob.weekEntries === 'object') ? blob.weekEntries : {};
  const weKeys = Object.keys(blobWE);
  console.log('[migrate] WeekEntries in blob: ' + weKeys.length);
  let weMigrated = 0, weSkipped = 0;
  for (const compositeKey of weKeys) {
    const we = blobWE[compositeKey];
    if (!we || typeof we !== 'object') { weSkipped++; continue; }

    const sepIdx = compositeKey.indexOf(':::');
    if (sepIdx === -1) { weSkipped++; continue; }
    const weekId = compositeKey.slice(0, sepIdx);
    const recKey = compositeKey.slice(sepIdx + 3);

    try {
      // Check if a (week_id, rec_key) combo already exists — avoid double-insert
      const existing = await query(
        'SELECT id FROM week_entries WHERE week_id = $1 AND rec_key = $2 LIMIT 1',
        [weekId, recKey]
      );
      if (existing.rows.length > 0) { weSkipped++; continue; }

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
      if (r.rowCount > 0) weMigrated++;
      else weSkipped++;
    } catch (e) {
      console.error('[migrate] WeekEntry insert error (key=' + compositeKey + '):', e.message);
      weSkipped++;
    }
  }
  summary.weekEntries = weMigrated;
  summary.skipped += weSkipped;
  console.log('[migrate] WeekEntries migrated: ' + weMigrated + ' (skipped: ' + weSkipped + ')');

  // ── NOTIFICATIONS ─────────────────────────────────────────────────────────
  const blobNotifs = Array.isArray(blob.notifications) ? blob.notifications : [];
  console.log('[migrate] Notifications in blob: ' + blobNotifs.length);
  let notifMigrated = 0, notifSkipped = 0;
  for (const n of blobNotifs) {
    if (!n || !n.id) { notifSkipped++; continue; }
    try {
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
      if (r.rowCount > 0) notifMigrated++;
      else notifSkipped++;
    } catch (e) {
      console.error('[migrate] Notification insert error (id=' + n.id + '):', e.message);
      notifSkipped++;
    }
  }
  summary.notifications = notifMigrated;
  summary.skipped += notifSkipped;
  console.log('[migrate] Notifications migrated: ' + notifMigrated + ' (skipped: ' + notifSkipped + ')');

  // ── CHANGE LOG ────────────────────────────────────────────────────────────
  // change_log uses BIGSERIAL id — no blob id to preserve.
  // Skip entirely if the table already has data (idempotency).
  let clMigrated = 0, clSkipped = 0;
  try {
    const clCount = await query('SELECT COUNT(*) FROM change_log');
    const existingClRows = parseInt(clCount.rows[0].count, 10);
    const blobCL = Array.isArray(blob.changeLog) ? blob.changeLog : [];
    console.log('[migrate] ChangeLog in blob: ' + blobCL.length);

    if (existingClRows > 0) {
      console.log('[migrate] change_log already has ' + existingClRows + ' rows — skipping changeLog migration');
      clSkipped = blobCL.length;
    } else {
      for (const entry of blobCL) {
        if (!entry || !entry.at || !entry.by || !entry.rkey || !entry.field) {
          clSkipped++; continue;
        }
        try {
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
          clMigrated++;
        } catch (e) {
          console.error('[migrate] ChangeLog insert error:', e.message);
          clSkipped++;
        }
      }
    }
  } catch (e) {
    console.error('[migrate] ChangeLog migration error:', e.message);
  }
  summary.changeLog = clMigrated;
  summary.skipped += clSkipped;
  console.log('[migrate] ChangeLog migrated: ' + clMigrated + ' (skipped: ' + clSkipped + ')');

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('\n[migrate] ====== Migration complete ======');
  console.log('[migrate] tasks:        ' + summary.tasks);
  console.log('[migrate] weekEntries:  ' + summary.weekEntries);
  console.log('[migrate] notifications:' + summary.notifications);
  console.log('[migrate] changeLog:    ' + summary.changeLog);
  console.log('[migrate] skipped:      ' + summary.skipped);
  console.log('[migrate] =================================\n');

  // Close the pool so the process exits cleanly
  await pool.end();
  process.exit(0);
}

main().catch(function (e) {
  console.error('[migrate] Fatal error:', e.message);
  pool.end().catch(function () {});
  process.exit(1);
});
