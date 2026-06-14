#!/usr/bin/env python3
"""
Find and restore weekEntries from app_data_history snapshots.
Usage:
    python3 scripts/restore_weekentries.py          # list snapshots
    python3 scripts/restore_weekentries.py --restore <id>  # restore weekEntries from snapshot
"""
import json, os, re, sys
import psycopg2
from datetime import datetime

def load_env():
    env = {}
    p = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(p):
        with open(p) as f:
            for line in f:
                m = re.match(r'^\s*([^#\s][^=]*?)\s*=\s*(.*)\s*$', line)
                if m:
                    env[m.group(1)] = m.group(2).strip().strip("'\"")
    return env

def main():
    env = load_env()
    conn = psycopg2.connect(
        host=env.get('PG_HOST','localhost'), port=int(env.get('PG_PORT','5432')),
        dbname=env.get('PG_DATABASE','atena_crm'), user=env.get('PG_USER','postgres'),
        password=env.get('PG_PASSWORD',''),
    )
    cur = conn.cursor()

    # Check if restoring a specific snapshot
    restore_id = None
    if '--restore' in sys.argv:
        idx = sys.argv.index('--restore')
        if idx + 1 < len(sys.argv):
            restore_id = int(sys.argv[idx + 1])

    # List all snapshots with weekEntries count
    cur.execute(
        "SELECT id, saved_at, saved_by, value FROM app_data_history WHERE key='main' ORDER BY saved_at DESC LIMIT 30"
    )
    rows = cur.fetchall()

    if not rows:
        print("❌ هیچ snapshot‌ای در تاریخچه وجود ندارد.")
        cur.close(); conn.close(); return

    print(f"{'ID':>6}  {'تاریخ ذخیره':25}  {'ذخیره‌کننده':20}  {'weekEntries':>12}  {'weekTags':>9}")
    print("─" * 80)
    best_id = None
    best_count = 0
    for row_id, saved_at, saved_by, value in rows:
        try:
            data = value if isinstance(value, dict) else json.loads(value)
            we_count = len(data.get('weekEntries', {}))
            wt_count = len(data.get('weekTags', {}))
        except Exception:
            we_count = wt_count = -1
        marker = ''
        if we_count > best_count:
            best_count = we_count
            best_id = row_id
        if we_count > 20:
            marker = ' ◄◄◄'
        print(f"{row_id:>6}  {str(saved_at):25}  {str(saved_by or ''):20}  {we_count:>12}  {wt_count:>9}{marker}")

    print(f"\nبهترین snapshot برای بازیابی: ID={best_id} با {best_count} weekEntry")
    print(f"برای بازیابی اجرا کنید:")
    print(f"  python3 scripts/restore_weekentries.py --restore {best_id}")

    if restore_id is not None:
        # Find the snapshot
        target = next(((r[0], r[3]) for r in rows if r[0] == restore_id), None)
        if not target:
            print(f"\n❌ snapshot با ID={restore_id} پیدا نشد.")
            cur.close(); conn.close(); return

        snap_id, snap_value = target
        snap_data = snap_value if isinstance(snap_value, dict) else json.loads(snap_value)
        snap_we = snap_data.get('weekEntries', {})
        snap_wt = snap_data.get('weekTags', {})

        print(f"\n🔄 بازیابی weekEntries از snapshot ID={snap_id}")
        print(f"   weekEntries در snapshot: {len(snap_we)}")
        print(f"   weekTags در snapshot: {len(snap_wt)}")

        # Load current DB
        cur.execute("SELECT value FROM app_data WHERE key='main'")
        cur_row = cur.fetchone()
        cur_db = cur_row[0] if cur_row else {}

        cur_we = cur_db.get('weekEntries', {})
        print(f"   weekEntries فعلی: {len(cur_we)}")

        # Merge: snapshot entries + current entries (current takes priority for same key)
        merged_we = dict(snap_we)
        merged_we.update(cur_we)  # current entries overwrite snapshot entries for same keys
        merged_wt = dict(snap_data.get('weekTags', {}))
        merged_wt.update(cur_db.get('weekTags', {}))

        print(f"   weekEntries بعد از merge: {len(merged_we)}")

        # Save backup of current to history first
        cur.execute(
            "INSERT INTO app_data_history (key, value, saved_by) VALUES ('main', %s, 'restore_script_backup')",
            (json.dumps(cur_db, ensure_ascii=False),)
        )

        # Update current DB
        cur_db['weekEntries'] = merged_we
        cur_db['weekTags'] = merged_wt

        cur.execute(
            "INSERT INTO app_data (key, value, updated_at, updated_by) VALUES ('main', %s, NOW(), 'restore_script') "
            "ON CONFLICT (key) DO UPDATE SET value=%s, updated_at=NOW(), updated_by='restore_script'",
            (json.dumps(cur_db, ensure_ascii=False),) * 2
        )
        conn.commit()
        print(f"\n✅ بازیابی انجام شد. سرور ریستارت و hard-refresh بزنید.")
        print(f"   (از {len(cur_we)} به {len(merged_we)} weekEntry)")

    cur.close(); conn.close()

if __name__ == '__main__':
    main()
