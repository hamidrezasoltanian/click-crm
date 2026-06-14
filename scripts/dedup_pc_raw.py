#!/usr/bin/env python3
"""
Remove duplicate centers from PC_RAW.

When Mizito import ran before the name-key/id-key fix, it added centers
under province id keys (e.g. PC_RAW['p1']) even though the same center
already existed under the province name key (e.g. PC_RAW['فارس']).
This script removes those duplicates from the id-key arrays.

Usage:
    python3 scripts/dedup_pc_raw.py [--dry-run]
"""

import json
import os
import re
import sys

PROVINCE_MAP = {
    'فارس': 'p1', 'اصفهان': 'p2', 'سیستان و بلوچستان': 'p3',
    'مازندران': 'p4', 'آذربایجان شرقی': 'p5', 'لرستان': 'p6',
    'بوشهر': 'p7', 'گلستان': 'p8', 'خراسان جنوبی': 'p9',
    'چهارمحال و بختیاری': 'p10', 'اردبیل': 'p11', 'خراسان رضوی': 'p12',
    'یزد': 'p13', 'قم': 'p14', 'زنجان': 'p15', 'مرکزی': 'p16',
    'گیلان': 'p17', 'خراسان شمالی': 'p18', 'ایلام': 'p19',
    'خوزستان': 'p20', 'کرمانشاه': 'p21', 'آذربایجان غربی': 'p22',
    'کرمان': 'p23', 'البرز': 'p24', 'همدان': 'p25', 'قزوین': 'p26',
    'کردستان': 'p27', 'هرمزگان': 'p28', 'کهگیلویه و بویراحمد': 'p29',
    'سمنان': 'p30',
}
PROV_ID_TO_NAME = {v: k for k, v in PROVINCE_MAP.items()}

import psycopg2


def load_env():
    env = {}
    env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                m = re.match(r'^\s*([^#\s][^=]*?)\s*=\s*(.*)\s*$', line)
                if m:
                    env[m.group(1)] = m.group(2).strip().strip("'\"")
    return env


def norm_name(n):
    return (n or '').strip().replace('ي', 'ی').replace('ك', 'ک')


def main():
    dry_run = '--dry-run' in sys.argv
    if dry_run:
        print('DRY RUN — no changes will be saved')

    env = load_env()
    conn = psycopg2.connect(
        host=env.get('PG_HOST', 'localhost'),
        port=int(env.get('PG_PORT', '5432')),
        dbname=env.get('PG_DATABASE', 'atena_crm'),
        user=env.get('PG_USER', 'postgres'),
        password=env.get('PG_PASSWORD', ''),
    )
    cur = conn.cursor()

    cur.execute("SELECT key, data FROM centers_master WHERE key IN ('CENTERS', 'PC_RAW')")
    rows = cur.fetchall()
    data = {r[0]: r[1] for r in rows}
    PC_RAW = data.get('PC_RAW', {})

    total_removed = 0

    for prov_id, pname in PROV_ID_TO_NAME.items():
        name_list = PC_RAW.get(pname, [])
        id_list = PC_RAW.get(prov_id, [])

        if not name_list or not id_list:
            continue

        # Build set of normalized names from the name-key array
        name_key_names = set()
        for r in name_list:
            if isinstance(r, dict):
                name_key_names.add(norm_name(r.get('name', '')))
            elif isinstance(r, list) and len(r) > 1:
                name_key_names.add(norm_name(r[1]))

        # Filter id-key array: keep only centers NOT in name-key array
        kept = []
        removed = []
        for r in id_list:
            rname = norm_name(r.get('name', '') if isinstance(r, dict) else (r[1] if isinstance(r, list) and len(r) > 1 else ''))
            if rname and rname in name_key_names:
                removed.append(rname)
            else:
                kept.append(r)

        if removed:
            print(f'  [{prov_id} / {pname}] removing {len(removed)} duplicates:')
            for n in removed[:5]:
                print(f'    - {n}')
            if len(removed) > 5:
                print(f'    ... and {len(removed)-5} more')
            total_removed += len(removed)
            if not dry_run:
                if kept:
                    # Re-index rows
                    for i, r in enumerate(kept):
                        if isinstance(r, dict):
                            r['row'] = i
                    PC_RAW[prov_id] = kept
                else:
                    del PC_RAW[prov_id]

    print(f'\nTotal duplicates removed: {total_removed}')

    if dry_run:
        print('DRY RUN — no changes saved')
        cur.close()
        conn.close()
        return

    if total_removed == 0:
        print('Nothing to clean up.')
        cur.close()
        conn.close()
        return

    cur.execute(
        """INSERT INTO centers_master (key, data, updated_at)
           VALUES ('PC_RAW', %s, NOW())
           ON CONFLICT (key) DO UPDATE SET data = %s, updated_at = NOW()""",
        (json.dumps(PC_RAW, ensure_ascii=False), json.dumps(PC_RAW, ensure_ascii=False))
    )
    conn.commit()
    cur.close()
    conn.close()
    print('✅ Cleanup complete! Restart the server and hard-refresh.')


if __name__ == '__main__':
    main()
