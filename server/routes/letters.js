'use strict';

const express = require('express');
const { query, pool } = require('../db');
const { requireAuth, requireManager } = require('../auth');

const router = express.Router();

function genId() {
  return 'let_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function rowToObj(r) {
  return {
    id:               r.id,
    type:             r.type,
    subject:          r.subject,
    body:             r.body,
    priority:         r.priority,
    classification:   r.classification,
    departmentPrefix: r.department_prefix,
    indicatorNumber:  r.indicator_number,
    indicatorSeq:     r.indicator_seq,
    senderName:       r.sender_name,
    receivers:        r.receivers || [],
    status:           r.status,
    createdBy:        r.created_by,
    createdAt:        r.created_at,
    updatedAt:        r.updated_at,
    registeredAt:     r.registered_at,
    isArchived:       r.is_archived,
    isDeleted:        r.is_deleted,
  };
}

function isManager(req) {
  return ['مدیر', 'سوپر ادمین'].includes(req.user.role);
}

// ── GET /api/letters — list ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { type, status, q } = req.query;
    const conditions = ['l.is_deleted = false'];
    const params = [];
    let idx = 1;

    if (!isManager(req)) {
      conditions.push(
        `(l.created_by = $${idx} OR l.id IN (SELECT letter_id FROM letter_referrals WHERE to_user = $${idx}))`
      );
      params.push(req.user.username);
      idx++;
    }
    if (type)   { conditions.push(`l.type = $${idx++}`);   params.push(type); }
    if (status) { conditions.push(`l.status = $${idx++}`); params.push(status); }
    if (q)      { conditions.push(`l.subject ILIKE $${idx++}`); params.push('%' + q + '%'); }

    const where = 'WHERE ' + conditions.join(' AND ');
    const rows = await query(
      `SELECT l.* FROM letters l ${where} ORDER BY l.created_at DESC LIMIT 300`,
      params
    );
    res.json(rows.rows.map(rowToObj));
  } catch (e) {
    console.error('[letters GET]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/letters/counts — unread referral counts ───────────────────────
router.get('/counts', requireAuth, async (req, res) => {
  try {
    const r = await query(
      `SELECT COUNT(*) AS unread FROM letter_referrals
       WHERE to_user = $1 AND is_read = false`,
      [req.user.username]
    );
    res.json({ unread: parseInt(r.rows[0].unread) });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/letters/cartable — referrals to me ─────────────────────────────
router.get('/cartable', requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT lr.*, l.subject, l.type, l.status AS letter_status,
              l.indicator_number, l.priority, l.created_by AS letter_creator
       FROM letter_referrals lr
       JOIN letters l ON l.id = lr.letter_id
       WHERE lr.to_user = $1 AND l.is_deleted = false
       ORDER BY lr.created_at DESC LIMIT 200`,
      [req.user.username]
    );
    res.json(rows.rows);
  } catch (e) {
    console.error('[letters cartable]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/letters/templates ──────────────────────────────────────────────
router.get('/templates', requireAuth, async (req, res) => {
  try {
    const rows = await query(
      `SELECT * FROM letter_templates ORDER BY created_at DESC LIMIT 200`
    );
    res.json(rows.rows);
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/letters/templates ─────────────────────────────────────────────
router.post('/templates', requireAuth, async (req, res) => {
  try {
    const { title, type, body } = req.body;
    if (!title) return res.status(400).json({ error: 'عنوان الزامی است' });
    const id = 'tpl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const r = await query(
      `INSERT INTO letter_templates (id, title, type, body, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, title, type || null, body || '', req.user.username]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── DELETE /api/letters/templates/:id ───────────────────────────────────────
router.delete('/templates/:id', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM letter_templates WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── GET /api/letters/:id — single letter + referrals ───────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM letters WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'نامه یافت نشد' });

    const letter = rowToObj(r.rows[0]);

    // Check visibility
    if (!isManager(req)) {
      const hasAccess = letter.createdBy === req.user.username;
      if (!hasAccess) {
        const refCheck = await query(
          `SELECT 1 FROM letter_referrals WHERE letter_id = $1 AND to_user = $2`,
          [req.params.id, req.user.username]
        );
        if (!refCheck.rows.length) {
          return res.status(403).json({ error: 'دسترسی ندارید' });
        }
      }
    }

    const refs = await query(
      `SELECT * FROM letter_referrals WHERE letter_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    letter.referrals = refs.rows;

    // Mark referrals to this user as read
    await query(
      `UPDATE letter_referrals SET is_read = true WHERE letter_id = $1 AND to_user = $2`,
      [req.params.id, req.user.username]
    );

    res.json(letter);
  } catch (e) {
    console.error('[letters GET/:id]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/letters — create ──────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const { type, subject, body, priority, classification, departmentPrefix, senderName, receivers } = req.body;
    if (!type || !['outgoing', 'incoming', 'internal'].includes(type)) {
      return res.status(400).json({ error: 'نوع نامه الزامی است' });
    }
    if (!subject) return res.status(400).json({ error: 'موضوع الزامی است' });

    const id = genId();
    const r = await query(
      `INSERT INTO letters (id,type,subject,body,priority,classification,
         department_prefix,sender_name,receivers,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING *`,
      [
        id, type, subject, body || '',
        priority || 'normal',
        classification || 'normal',
        departmentPrefix || 'الف',
        senderName || '',
        JSON.stringify(receivers || []),
        req.user.username,
      ]
    );
    res.status(201).json(rowToObj(r.rows[0]));
  } catch (e) {
    console.error('[letters POST]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── PUT /api/letters/:id — update draft ─────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const existing = await query(
      'SELECT * FROM letters WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'نامه یافت نشد' });
    if (existing.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'فقط پیش‌نویس قابل ویرایش است' });
    }
    if (!isManager(req) && existing.rows[0].created_by !== req.user.username) {
      return res.status(403).json({ error: 'دسترسی ندارید' });
    }

    const { subject, body, priority, classification, departmentPrefix, senderName, receivers } = req.body;
    const r = await query(
      `UPDATE letters SET
         subject=$1, body=$2, priority=$3, classification=$4,
         department_prefix=$5, sender_name=$6, receivers=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [
        subject || existing.rows[0].subject,
        body !== undefined ? body : existing.rows[0].body,
        priority || existing.rows[0].priority,
        classification || existing.rows[0].classification,
        departmentPrefix || existing.rows[0].department_prefix,
        senderName !== undefined ? senderName : existing.rows[0].sender_name,
        JSON.stringify(receivers !== undefined ? receivers : existing.rows[0].receivers),
        req.params.id,
      ]
    );
    res.json(rowToObj(r.rows[0]));
  } catch (e) {
    console.error('[letters PUT]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/letters/:id/register — issue indicator number ────────────────
router.post('/:id/register', requireManager, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT * FROM letters WHERE id = $1 AND is_deleted = false FOR UPDATE',
      [req.params.id]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'نامه یافت نشد' });
    }
    const letter = existing.rows[0];
    if (letter.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'فقط پیش‌نویس قابل صدور شماره است' });
    }

    const prefix = req.body.prefix || letter.department_prefix || 'الف';
    const jalaliYearMonth = req.body.jalaliYearMonth; // e.g. "40306"
    if (!jalaliYearMonth || !/^\d{5,6}$/.test(jalaliYearMonth)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'سال/ماه جلالی الزامی است (مثلاً 40306)' });
    }

    const typeCode = { outgoing: 'ص', incoming: 'و', internal: 'د' }[letter.type];

    await client.query(
      `INSERT INTO letter_indicator_seq (prefix, type_code, year_month, seq)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (prefix, type_code, year_month)
       DO UPDATE SET seq = letter_indicator_seq.seq + 1`,
      [prefix, typeCode, jalaliYearMonth]
    );
    const seqRes = await client.query(
      `SELECT seq FROM letter_indicator_seq WHERE prefix=$1 AND type_code=$2 AND year_month=$3`,
      [prefix, typeCode, jalaliYearMonth]
    );
    const seq = seqRes.rows[0].seq;
    const indicatorNumber = `${prefix}/${typeCode}-${String(seq).padStart(3, '0')}-${jalaliYearMonth}`;

    const r = await client.query(
      `UPDATE letters SET
         indicator_number=$1, indicator_seq=$2, status='registered',
         registered_at=NOW(), updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [indicatorNumber, seq, req.params.id]
    );
    await client.query('COMMIT');
    res.json(rowToObj(r.rows[0]));
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[letters register]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  } finally {
    client.release();
  }
});

// ── POST /api/letters/:id/refer — refer to another user ────────────────────
router.post('/:id/refer', requireAuth, async (req, res) => {
  try {
    const { toUser, actionType, description } = req.body;
    if (!toUser) return res.status(400).json({ error: 'کاربر مقصد الزامی است' });

    const existing = await query(
      'SELECT id FROM letters WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'نامه یافت نشد' });

    const id = 'ref_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const r = await query(
      `INSERT INTO letter_referrals (id, letter_id, from_user, to_user, action_type, description)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        id, req.params.id, req.user.username, toUser,
        actionType || 'for_info',
        description || '',
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error('[letters refer]', e.message);
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── PUT /api/letters/referrals/:rid/read ────────────────────────────────────
router.put('/referrals/:rid/read', requireAuth, async (req, res) => {
  try {
    await query(
      `UPDATE letter_referrals SET is_read = true WHERE id = $1 AND to_user = $2`,
      [req.params.rid, req.user.username]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── PUT /api/letters/referrals/:rid/complete ─────────────────────────────────
router.put('/referrals/:rid/complete', requireAuth, async (req, res) => {
  try {
    const { note } = req.body;
    const r = await query(
      `UPDATE letter_referrals SET is_completed = true, completion_note = $1
       WHERE id = $2 AND to_user = $3 RETURNING *`,
      [note || '', req.params.rid, req.user.username]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'ارجاع یافت نشد' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── POST /api/letters/:id/archive ───────────────────────────────────────────
router.post('/:id/archive', requireAuth, async (req, res) => {
  try {
    const r = await query(
      `UPDATE letters SET is_archived = true, status = 'archived', updated_at = NOW()
       WHERE id = $1 AND is_deleted = false RETURNING *`,
      [req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'نامه یافت نشد' });
    res.json(rowToObj(r.rows[0]));
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

// ── DELETE /api/letters/:id — soft delete (draft only) ──────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const existing = await query(
      'SELECT status, created_by FROM letters WHERE id = $1 AND is_deleted = false',
      [req.params.id]
    );
    if (!existing.rows.length) return res.status(404).json({ error: 'نامه یافت نشد' });
    if (existing.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'فقط پیش‌نویس قابل حذف است' });
    }
    if (!isManager(req) && existing.rows[0].created_by !== req.user.username) {
      return res.status(403).json({ error: 'دسترسی ندارید' });
    }
    await query(
      `UPDATE letters SET is_deleted = true, updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'خطای سرور' });
  }
});

module.exports = router;
