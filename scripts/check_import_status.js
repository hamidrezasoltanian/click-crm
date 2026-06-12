'use strict';
// Run: node scripts/check_import_status.js
const { pool } = require('../server/db');

async function main() {
  try {
    // 1. Check centers_master
    const masterRes = await pool.query("SELECT key, jsonb_array_length(data) as cnt, updated_at FROM centers_master ORDER BY key");
    console.log('\n=== centers_master ===');
    if (masterRes.rows.length === 0) {
      console.log('  ⚠️  خالی است — هیچ داده‌ای import نشده');
    } else {
      for (const r of masterRes.rows) {
        let cnt = r.cnt;
        if (r.key === 'PC_RAW') {
          // PC_RAW is an object, count provinces and centers
          const raw = await pool.query("SELECT data FROM centers_master WHERE key='PC_RAW'");
          const pcRaw = raw.rows[0]?.data || {};
          const provCount = Object.keys(pcRaw).length;
          const centerCount = Object.values(pcRaw).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
          console.log(`  ${r.key}: ${provCount} استان، ${centerCount} مرکز — آخرین آپدیت: ${r.updated_at?.toLocaleString('fa-IR') || '-'}`);
        } else {
          console.log(`  ${r.key}: ${cnt} مرکز — آخرین آپدیت: ${r.updated_at?.toLocaleString('fa-IR') || '-'}`);
        }
      }
    }

    // 2. Check mizito import markers in app_data
    const dbRes = await pool.query("SELECT value->'edits' as edits, updated_by, updated_at FROM app_data WHERE key='main'");
    if (dbRes.rows.length === 0) {
      console.log('\n=== app_data (main) ===\n  ⚠️  خالی است');
    } else {
      const row = dbRes.rows[0];
      const edits = row.edits || {};
      const keys = Object.keys(edits);
      const mizitoKeys = keys.filter(k => edits[k]?._mizitoRow !== undefined);
      console.log('\n=== app_data (main) ===');
      console.log(`  تعداد کل edits: ${keys.length}`);
      console.log(`  از میزیتو import شده: ${mizitoKeys.length}`);
      console.log(`  آخرین ذخیره توسط: ${row.updated_by || '-'} در ${row.updated_at?.toLocaleString('fa-IR') || '-'}`);

      if (mizitoKeys.length > 0) {
        console.log('\n  ✅ داده میزیتو وارد شده است');
        console.log(`  نمونه مراکز import شده:`);
        mizitoKeys.slice(0, 5).forEach(k => {
          const e = edits[k];
          console.log(`    - ${k}: ${e.address?.slice(0,40) || 'بدون آدرس'} | وضعیت: ${e.status || '-'}`);
        });
      } else {
        console.log('\n  ❌ داده میزیتو هنوز import نشده');
      }
    }

    // 3. Check PC_RAW mizito markers
    const pcRes = await pool.query("SELECT data FROM centers_master WHERE key='PC_RAW'");
    if (pcRes.rows.length > 0) {
      const pcRaw = pcRes.rows[0].data || {};
      let mizitoCount = 0;
      let totalCount = 0;
      for (const [prov, centers] of Object.entries(pcRaw)) {
        if (Array.isArray(centers)) {
          totalCount += centers.length;
          mizitoCount += centers.filter(c => c._mizito).length;
        }
      }
      console.log('\n=== PC_RAW (مراکز استانی) ===');
      console.log(`  کل مراکز: ${totalCount}`);
      console.log(`  از میزیتو اضافه شده: ${mizitoCount}`);
      console.log(`  قبلاً موجود بوده: ${totalCount - mizitoCount}`);
    }

    // 4. Check CENTERS (Tehran) mizito markers
    const cRes = await pool.query("SELECT data FROM centers_master WHERE key='CENTERS'");
    if (cRes.rows.length > 0) {
      const centers = cRes.rows[0].data || [];
      const mizitoTehran = centers.filter(c => c._mizito).length;
      console.log('\n=== CENTERS (تهران) ===');
      console.log(`  کل مراکز: ${centers.length}`);
      console.log(`  از میزیتو اضافه شده: ${mizitoTehran}`);
    }

  } catch (e) {
    console.error('خطا:', e.message);
  } finally {
    await pool.end();
  }
}

main();
