'use strict';

function genId(prefix) {
  const p = prefix || 'wms';
  return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

async function nextTxnNo(client, type) {
  const prefix = type === 'exit' ? 'EXT' : 'ENT';
  const settingKey = type === 'exit' ? 'seq_exit' : 'seq_entry';
  await client.query(
    `INSERT INTO wms_settings (key, value, updated_at) VALUES ($1, '1000'::jsonb, NOW())
     ON CONFLICT (key) DO NOTHING`,
    [settingKey]
  );
  const r = await client.query(
    `UPDATE wms_settings SET value = (value::int + 1)::text::jsonb, updated_at = NOW()
     WHERE key = $1 RETURNING value::int AS seq`,
    [settingKey]
  );
  return `${prefix}-${String(r.rows[0].seq).padStart(4, '0')}`;
}

async function nextWpfNo(client) {
  const year = new Date().getFullYear();
  const key = `seq_wpf_${year}`;
  await client.query(
    `INSERT INTO wms_settings (key, value, updated_at) VALUES ($1, '0'::jsonb, NOW())
     ON CONFLICT (key) DO NOTHING`,
    [key]
  );
  const r = await client.query(
    `UPDATE wms_settings SET value = (value::int + 1)::text::jsonb, updated_at = NOW()
     WHERE key = $1 RETURNING value::int AS seq`,
    [key]
  );
  return `WPF-${year}-${String(r.rows[0].seq).padStart(4, '0')}`;
}

module.exports = { genId, nextTxnNo, nextWpfNo };
