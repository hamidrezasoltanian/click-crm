#!/usr/bin/env python3
"""
Merge all duplicate centers across all provinces AND Tehran.

Provinces (p1-p30):
  Merges PC_RAW[id-key] (e.g. PC_RAW['p1']) into PC_RAW[name-key]
  (e.g. PC_RAW['فارس']), consolidating DB.edits along the way.
  Removes id-key arrays after merge.

Tehran:
  Finds duplicate entries inside CENTERS (where a Mizito-added mz_t_XXXX
  entry has the same name as an existing center) and merges their edits.

Usage:
    python3 scripts/merge_pc_raw.py [--dry-run]
"""

import json
import os
import re
import sys

import psycopg2

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


def norm(s):
    return (s or '').strip().replace('ي', 'ی').replace('ك', 'ک').replace('‌', ' ').replace('  ', ' ')


def get_center_name(r):
    if isinstance(r, dict):
        return norm(r.get('name', ''))
    elif isinstance(r, list) and len(r) > 1:
        return norm(r[1])
    return ''


def get_row(r):
    if isinstance(r, dict):
        return r.get('row', r.get('n', 0))
    elif isinstance(r, list):
        return r[0]
    return 0


def merge_edit_data(target, source):
    """Merge source edit dict into target edit dict. Non-destructive."""
    if not source:
        return target
    if not target:
        return dict(source)

    # Merge contacts
    target_contacts = target.get('contacts', [])
    source_contacts = source.get('contacts', [])
    existing_names = {c.get('name', '') for c in target_contacts}
    for ct in source_contacts:
        cname = ct.get('name', '')
        if cname not in existing_names:
            target_contacts.append(ct)
            existing_names.add(cname)
        else:
            existing_ct = next((x for x in target_contacts if x.get('name', '') == cname), None)
            if existing_ct:
                ep = set(existing_ct.get('phones', []))
                for ph in ct.get('phones', []):
                    if ph and ph not in ep:
                        existing_ct.setdefault('phones', []).append(ph)
                        ep.add(ph)
    target['contacts'] = target_contacts

    # Fill empty fields from source
    for field in ['address', 'status', 'lead', 'potential', 'type']:
        if not target.get(field) and source.get(field):
            target[field] = source[field]

    return target


def rekey_edit(edits, rTags, old_key, new_key):
    """Move edits and rTags from old_key to new_key, merging if new_key already exists."""
    if old_key == new_key:
        return
    src = edits.get(old_key)
    if src:
        existing = edits.get(new_key, {})
        edits[new_key] = merge_edit_data(existing, src)
        del edits[old_key]
    if old_key in rTags:
        existing_tags = rTags.get(new_key, [])
        for tag in rTags[old_key]:
            if tag not in existing_tags:
                existing_tags.append(tag)
        rTags[new_key] = existing_tags
        del rTags[old_key]


def main():
    dry_run = '--dry-run' in sys.argv
    if dry_run:
        print('DRY RUN — no changes will be saved\n')

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
    cm_rows = cur.fetchall()
    cm_data = {r[0]: r[1] for r in cm_rows}
    PC_RAW = cm_data.get('PC_RAW', {})
    CENTERS = cm_data.get('CENTERS', [])

    cur.execute("SELECT value FROM app_data WHERE key = 'main'")
    row = cur.fetchone()
    DB = row[0] if row else {}
    if not DB:
        DB = {}
    edits = DB.get('edits', {})
    rTags = DB.get('rTags', {})

    total_prov_merged = 0
    total_prov_new = 0
    total_tehran_merged = 0

    # ── 1. Merge province id-key arrays into name-key arrays ──────────────────
    print('=== Provinces ===')
    for prov_id, pname in PROV_ID_TO_NAME.items():
        id_list = PC_RAW.get(prov_id, [])
        if not id_list:
            continue

        name_list = PC_RAW.get(pname, [])
        if name_list is None:
            name_list = []

        # Build lookup: normalized name → (index_in_name_list, row_value)
        name_lookup = {}
        for i, r in enumerate(name_list):
            n = get_center_name(r)
            if n:
                name_lookup[n] = (i, get_row(r))

        merged = 0
        added = 0

        for id_center in id_list:
            cname = get_center_name(id_center)
            id_row = get_row(id_center)
            id_edit_key = f"pc_{prov_id}||{id_row}"

            if cname in name_lookup:
                # Duplicate — merge edits into canonical key
                _, canonical_row = name_lookup[cname]
                canonical_key = f"pc_{prov_id}||{canonical_row}"
                if not dry_run:
                    rekey_edit(edits, rTags, id_edit_key, canonical_key)
                merged += 1
            else:
                # Unique Mizito center — add to name-key array
                new_row = len(name_list) + added  # account for ones added this loop
                new_canonical_key = f"pc_{prov_id}||{new_row}"
                new_entry = {'row': new_row, 'name': cname,
                             'type': id_center.get('type', '') if isinstance(id_center, dict) else '',
                             'lead': id_center.get('lead', 'سرنخ') if isinstance(id_center, dict) else 'سرنخ',
                             'owner': id_center.get('owner', '') if isinstance(id_center, dict) else '',
                             '_mizito': True}
                if not dry_run:
                    name_list.append(new_entry)
                    rekey_edit(edits, rTags, id_edit_key, new_canonical_key)
                added += 1

        if merged or added:
            print(f'  [{prov_id}/{pname}]: merged {merged} duplicates, added {added} new')

        if not dry_run:
            PC_RAW[pname] = name_list
            if prov_id in PC_RAW:
                del PC_RAW[prov_id]

        total_prov_merged += merged
        total_prov_new += added

    # ── 2. Merge Tehran duplicates inside CENTERS array ───────────────────────
    print('\n=== Tehran ===')
    # Find original (non-mizito) centers and mizito-added ones
    original_centers = {}  # normalized name → index
    mizito_centers = []    # (index, center) for mz_t_ ones

    for i, c in enumerate(CENTERS):
        cid = c.get('id', '')
        cname = norm(c.get('name', ''))
        if not cname:
            continue
        if cid.startswith('mz_t_'):
            mizito_centers.append((i, c))
        else:
            original_centers[cname] = (i, cid)

    # Also check mizito centers that are duplicates of OTHER mizito centers
    seen_mz_names = {}
    indices_to_remove = set()

    for idx, c in mizito_centers:
        cname = norm(c.get('name', ''))
        cid = c.get('id', '')
        mz_edit_key = f"center_{cid}"

        if cname in original_centers:
            # Duplicate of an original center
            orig_idx, orig_id = original_centers[cname]
            orig_edit_key = f"center_{orig_id}"
            print(f'  Merge mz→original: {cname[:50]}')
            if not dry_run:
                rekey_edit(edits, rTags, mz_edit_key, orig_edit_key)
            indices_to_remove.add(idx)
            total_tehran_merged += 1
        elif cname in seen_mz_names:
            # Duplicate of another mizito center — merge into the first one seen
            first_id = seen_mz_names[cname]
            first_edit_key = f"center_{first_id}"
            print(f'  Merge mz→mz: {cname[:50]}')
            if not dry_run:
                rekey_edit(edits, rTags, mz_edit_key, first_edit_key)
            indices_to_remove.add(idx)
            total_tehran_merged += 1
        else:
            seen_mz_names[cname] = cid

    if indices_to_remove:
        print(f'  Removing {len(indices_to_remove)} duplicate Tehran centers')
        if not dry_run:
            CENTERS[:] = [c for i, c in enumerate(CENTERS) if i not in indices_to_remove]
    else:
        print('  No Tehran duplicates found')

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f'\n=== Summary ===')
    print(f'  Provinces — merged: {total_prov_merged}, new unique: {total_prov_new}')
    print(f'  Tehran    — merged: {total_tehran_merged}')

    if dry_run:
        print('\nDRY RUN — no changes saved')
        cur.close()
        conn.close()
        return

    if total_prov_merged + total_prov_new + total_tehran_merged == 0:
        print('Nothing to merge.')
        cur.close()
        conn.close()
        return

    DB['edits'] = edits
    DB['rTags'] = rTags

    print('\nSaving to database...')
    cur.execute(
        "INSERT INTO centers_master (key, data, updated_at) VALUES ('PC_RAW', %s, NOW()) "
        "ON CONFLICT (key) DO UPDATE SET data = %s, updated_at = NOW()",
        (json.dumps(PC_RAW, ensure_ascii=False), json.dumps(PC_RAW, ensure_ascii=False))
    )
    cur.execute(
        "INSERT INTO centers_master (key, data, updated_at) VALUES ('CENTERS', %s, NOW()) "
        "ON CONFLICT (key) DO UPDATE SET data = %s, updated_at = NOW()",
        (json.dumps(CENTERS, ensure_ascii=False), json.dumps(CENTERS, ensure_ascii=False))
    )
    cur.execute(
        "INSERT INTO app_data (key, value, updated_at, updated_by) VALUES ('main', %s, NOW(), 'merge_script') "
        "ON CONFLICT (key) DO UPDATE SET value = %s, updated_at = NOW(), updated_by = 'merge_script'",
        (json.dumps(DB, ensure_ascii=False), json.dumps(DB, ensure_ascii=False))
    )
    conn.commit()
    cur.close()
    conn.close()
    print('✅ Merge complete! Restart the server and hard-refresh.')


if __name__ == '__main__':
    main()
