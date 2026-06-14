#!/usr/bin/env python3
"""
Full deduplication of ALL centers: Tehran + all 30 provinces.

Tehran:
  mz_t_ centers that match c_ centers are merged → removed.
  Matching: exact normalized name, or c_ name substring of mz_t_ name.

Provinces:
  Within each province array, _mizito-tagged entries that match existing
  (non-mizito) entries by name are merged → removed.

Usage:
    python3 scripts/dedup_all.py [--dry-run]
"""

import json, os, re, sys
import psycopg2

PROVINCE_MAP = {
    'فارس':'p1','اصفهان':'p2','سیستان و بلوچستان':'p3','مازندران':'p4',
    'آذربایجان شرقی':'p5','لرستان':'p6','بوشهر':'p7','گلستان':'p8',
    'خراسان جنوبی':'p9','چهارمحال و بختیاری':'p10','اردبیل':'p11',
    'خراسان رضوی':'p12','یزد':'p13','قم':'p14','زنجان':'p15','مرکزی':'p16',
    'گیلان':'p17','خراسان شمالی':'p18','ایلام':'p19','خوزستان':'p20',
    'کرمانشاه':'p21','آذربایجان غربی':'p22','کرمان':'p23','البرز':'p24',
    'همدان':'p25','قزوین':'p26','کردستان':'p27','هرمزگان':'p28',
    'کهگیلویه و بویراحمد':'p29','سمنان':'p30',
}
PROV_ID_TO_NAME = {v:k for k,v in PROVINCE_MAP.items()}


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


def norm(s):
    s = (s or '').strip().replace('ي','ی').replace('ك','ک')
    s = re.sub(r'[‌‍‌-‏]', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def center_name(r):
    if isinstance(r, dict): return norm(r.get('name',''))
    if isinstance(r, list) and len(r)>1: return norm(r[1])
    return ''


def center_row(r):
    if isinstance(r, dict): return r.get('row', r.get('n', 0))
    if isinstance(r, list): return r[0]
    return 0


def is_mizito(r):
    return isinstance(r, dict) and r.get('_mizito', False)


def name_matches(mz_name, orig_name):
    """True if names are duplicates (exact or orig embedded in mz description)."""
    if mz_name == orig_name:
        return True
    # orig name is a meaningful substring of mz name
    if len(orig_name) >= 6 and orig_name in mz_name:
        return True
    return False


def merge_edit(target, source):
    if not source: return target or {}
    if not target: return dict(source)
    tc = target.get('contacts', [])
    seen = {c.get('name','') for c in tc}
    for ct in source.get('contacts', []):
        cn = ct.get('name','')
        if cn not in seen:
            tc.append(ct); seen.add(cn)
        else:
            exc = next((x for x in tc if x.get('name','') == cn), None)
            if exc:
                ep = set(exc.get('phones',[]))
                for ph in ct.get('phones',[]):
                    if ph and ph not in ep:
                        exc.setdefault('phones',[]).append(ph); ep.add(ph)
    target['contacts'] = tc
    for f in ['address','status','lead','potential','type']:
        if not target.get(f) and source.get(f):
            target[f] = source[f]
    return target


def do_edit_merge(edits, rTags, notes_db, src_key, tgt_key):
    if src_key == tgt_key: return
    if src_key in edits:
        edits[tgt_key] = merge_edit(edits.get(tgt_key,{}), edits.pop(src_key))
    if src_key in rTags:
        ex = rTags.get(tgt_key,[])
        for t in rTags.pop(src_key):
            if t not in ex: ex.append(t)
        rTags[tgt_key] = ex
    if src_key in notes_db:
        notes_db.setdefault(tgt_key,[]).extend(notes_db.pop(src_key))


def main():
    dry_run = '--dry-run' in sys.argv
    if dry_run: print('DRY RUN — no changes will be saved\n')

    env = load_env()
    conn = psycopg2.connect(
        host=env.get('PG_HOST','localhost'), port=int(env.get('PG_PORT','5432')),
        dbname=env.get('PG_DATABASE','atena_crm'), user=env.get('PG_USER','postgres'),
        password=env.get('PG_PASSWORD',''),
    )
    cur = conn.cursor()

    cur.execute("SELECT key,data FROM centers_master WHERE key IN ('CENTERS','PC_RAW')")
    cm = {r[0]:r[1] for r in cur.fetchall()}
    CENTERS = cm.get('CENTERS', [])
    PC_RAW  = cm.get('PC_RAW', {})

    cur.execute("SELECT value FROM app_data WHERE key='main'")
    row = cur.fetchone()
    DB = (row[0] if row else {}) or {}
    edits    = DB.setdefault('edits', {})
    rTags    = DB.setdefault('rTags', {})
    notes_db = DB.setdefault('notes', {})

    total_removed = 0

    # ── 1. TEHRAN ─────────────────────────────────────────────────────────────
    print('=== تهران ===')
    original = {norm(c['name']): c for c in CENTERS if not c.get('id','').startswith('mz_t_')}
    mizito_centers = [c for c in CENTERS if c.get('id','').startswith('mz_t_')]
    remove_ids = set()

    for mz in mizito_centers:
        mz_name = norm(mz.get('name',''))
        mz_id   = mz['id']
        match   = None
        for orig_name, orig_c in original.items():
            if name_matches(mz_name, orig_name):
                match = orig_c
                break
        if match:
            print(f'  ✂ {mz_id}: "{mz_name[:45]}"  →  "{norm(match.get("name",""))[:45]}"')
            if not dry_run:
                do_edit_merge(edits, rTags, notes_db,
                              f'center_{mz_id}', f'center_{match["id"]}')
            remove_ids.add(mz_id)
            total_removed += 1

    if not dry_run:
        CENTERS[:] = [c for c in CENTERS if c.get('id') not in remove_ids]
    print(f'  تهران: {len(remove_ids)} تکراری یافت شد')

    # ── 2. PROVINCES ──────────────────────────────────────────────────────────
    print('\n=== استان‌ها ===')
    prov_total = 0

    for pname, prov_id in PROVINCE_MAP.items():
        arr = PC_RAW.get(pname, [])
        if not arr:
            continue

        # Separate original (non-mizito) and mizito entries
        originals = {}   # norm_name → index in arr
        dupes = []       # (index, entry) to remove

        for i, r in enumerate(arr):
            rname = center_name(r)
            if not rname:
                continue
            if is_mizito(r):
                # check against originals already seen
                matched = None
                for orig_name in originals:
                    if name_matches(rname, orig_name):
                        matched = orig_name
                        break
                if matched:
                    orig_idx = originals[matched]
                    orig_row = center_row(arr[orig_idx])
                    mz_row   = center_row(r)
                    src_key  = f'pc_{prov_id}||{mz_row}'
                    tgt_key  = f'pc_{prov_id}||{orig_row}'
                    print(f'  ✂ [{pname}] "{rname[:40]}"  →  "{matched[:40]}"')
                    if not dry_run:
                        do_edit_merge(edits, rTags, notes_db, src_key, tgt_key)
                    dupes.append(i)
                    prov_total += 1
                else:
                    originals[rname] = i
            else:
                originals[rname] = i

        if dupes and not dry_run:
            dupe_set = set(dupes)
            PC_RAW[pname] = [r for i, r in enumerate(arr) if i not in dupe_set]
            # Re-index rows
            for new_i, r in enumerate(PC_RAW[pname]):
                if isinstance(r, dict):
                    r['row'] = new_i

    print(f'  استان‌ها: {prov_total} تکراری یافت شد')

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f'\n=== نتیجه ===')
    print(f'  تهران:    {len(remove_ids)} حذف')
    print(f'  استان‌ها: {prov_total} حذف')
    print(f'  جمع:      {total_removed + prov_total} حذف')

    if dry_run:
        print('\nDRY RUN — ذخیره نشد')
        cur.close(); conn.close(); return

    if total_removed + prov_total == 0:
        print('تکراری یافت نشد.')
        cur.close(); conn.close(); return

    DB['edits']  = edits
    DB['rTags']  = rTags
    DB['notes']  = notes_db

    print('\nذخیره در دیتابیس...')
    cur.execute(
        "INSERT INTO centers_master (key,data,updated_at) VALUES ('CENTERS',%s,NOW()) "
        "ON CONFLICT (key) DO UPDATE SET data=%s,updated_at=NOW()",
        (json.dumps(CENTERS,ensure_ascii=False),)*2)
    cur.execute(
        "INSERT INTO centers_master (key,data,updated_at) VALUES ('PC_RAW',%s,NOW()) "
        "ON CONFLICT (key) DO UPDATE SET data=%s,updated_at=NOW()",
        (json.dumps(PC_RAW,ensure_ascii=False),)*2)
    cur.execute(
        "INSERT INTO app_data (key,value,updated_at,updated_by) VALUES ('main',%s,NOW(),'dedup_all') "
        "ON CONFLICT (key) DO UPDATE SET value=%s,updated_at=NOW(),updated_by='dedup_all'",
        (json.dumps(DB,ensure_ascii=False),)*2)
    conn.commit()
    cur.close(); conn.close()
    print('✅ تمیزکاری کامل شد! سرور را ریستارت و hard-refresh بزنید.')


if __name__ == '__main__':
    main()
