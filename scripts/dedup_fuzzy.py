#!/usr/bin/env python3
"""
Fuzzy deduplication using Jaccard token similarity for ALL centers.

Tehran:
  mz_t_ centers whose token-set overlaps >= threshold with c_ centers are merged.

Provinces:
  Within each province array, _mizito-tagged entries whose token-set overlaps
  >= threshold with existing (non-mizito) entries are merged → removed.

Tokenization: split on whitespace/punctuation, remove common stop words
(بیمارستان، مرکز، کلینیک، دکتر، etc.) then compute Jaccard similarity on token sets.

Usage:
    python3 scripts/dedup_fuzzy.py [--dry-run] [--threshold=0.7] [--medium]
    python3 scripts/dedup_fuzzy.py --dry-run --medium --threshold=0.5
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
PROV_ID_TO_NAME = {v: k for k, v in PROVINCE_MAP.items()}

STOP_WORDS = {
    'بیمارستان','مرکز','کلینیک','درمانگاه','داروخانه','آزمایشگاه',
    'دکتر','مطب','تخصصی','فوق','و','در','از','به','با','برای',
    'پزشکی','بهداشتی','درمانی','آموزشی','امام','شهید','آیت','الله',
    'حضرت','سیدالشهداء','ولی','عصر','پارس','ایران','ملی','عمومی',
    'خصوصی','دولتی','اجتماعی','بهزیستی','تامین','خدمات',
}


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
    s = (s or '').strip().replace('ي', 'ی').replace('ك', 'ک')
    s = re.sub(r'[‌‍‌-‏]', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def tokenize(s):
    s = norm(s)
    tokens = re.split(r'[\s\(\)\[\]\-_،,\.]+', s)
    return {t for t in tokens if len(t) >= 2 and t not in STOP_WORDS}


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def center_name(r):
    if isinstance(r, dict): return norm(r.get('name', ''))
    if isinstance(r, list) and len(r) > 1: return norm(r[1])
    return ''


def center_row(r):
    if isinstance(r, dict): return r.get('row', r.get('n', 0))
    if isinstance(r, list): return r[0]
    return 0


def is_mizito(r):
    return isinstance(r, dict) and r.get('_mizito', False)


def merge_edit(target, source):
    if not source: return target or {}
    if not target: return dict(source)
    tc = target.get('contacts', [])
    seen = {c.get('name', '') for c in tc}
    for ct in source.get('contacts', []):
        cn = ct.get('name', '')
        if cn not in seen:
            tc.append(ct); seen.add(cn)
        else:
            exc = next((x for x in tc if x.get('name', '') == cn), None)
            if exc:
                ep = set(exc.get('phones', []))
                for ph in ct.get('phones', []):
                    if ph and ph not in ep:
                        exc.setdefault('phones', []).append(ph); ep.add(ph)
    target['contacts'] = tc
    for f in ['address', 'status', 'lead', 'potential', 'type']:
        if not target.get(f) and source.get(f):
            target[f] = source[f]
    return target


def do_edit_merge(edits, rTags, notes_db, src_key, tgt_key):
    if src_key == tgt_key: return
    if src_key in edits:
        edits[tgt_key] = merge_edit(edits.get(tgt_key, {}), edits.pop(src_key))
    if src_key in rTags:
        ex = rTags.get(tgt_key, [])
        for t in rTags.pop(src_key):
            if t not in ex: ex.append(t)
        rTags[tgt_key] = ex
    if src_key in notes_db:
        notes_db.setdefault(tgt_key, []).extend(notes_db.pop(src_key))


def main():
    dry_run    = '--dry-run' in sys.argv
    inc_medium = '--medium'  in sys.argv
    threshold  = 0.7
    for a in sys.argv:
        if a.startswith('--threshold='):
            threshold = float(a.split('=')[1])

    if dry_run: print('DRY RUN — no changes will be saved\n')
    print(f'Jaccard threshold: {threshold}  (medium: {inc_medium})\n')

    env = load_env()
    conn = psycopg2.connect(
        host=env.get('PG_HOST','localhost'), port=int(env.get('PG_PORT','5432')),
        dbname=env.get('PG_DATABASE','atena_crm'), user=env.get('PG_USER','postgres'),
        password=env.get('PG_PASSWORD',''),
    )
    cur = conn.cursor()

    cur.execute("SELECT key,data FROM centers_master WHERE key IN ('CENTERS','PC_RAW')")
    cm = {r[0]: r[1] for r in cur.fetchall()}
    CENTERS = cm.get('CENTERS', [])
    PC_RAW  = cm.get('PC_RAW', {})

    cur.execute("SELECT value FROM app_data WHERE key='main'")
    row = cur.fetchone()
    DB = (row[0] if row else {}) or {}
    edits    = DB.setdefault('edits', {})
    rTags    = DB.setdefault('rTags', {})
    notes_db = DB.setdefault('notes', {})

    tehran_removed = 0
    prov_removed   = 0

    # ── 1. TEHRAN ─────────────────────────────────────────────────────────────
    print('=== تهران ===')
    original_list = [c for c in CENTERS if not c.get('id','').startswith('mz_t_')]
    mizito_list   = [c for c in CENTERS if c.get('id','').startswith('mz_t_')]

    # Build token sets for originals
    orig_tokens = {}  # id → (tokens, name)
    for c in original_list:
        toks = tokenize(c.get('name', ''))
        if toks:
            orig_tokens[c['id']] = (toks, norm(c.get('name','')))

    remove_ids = set()
    medium_matches = []

    for mz in mizito_list:
        mz_name = norm(mz.get('name', ''))
        mz_id   = mz['id']
        mz_toks = tokenize(mz_name)
        if not mz_toks:
            continue

        best_score = 0.0
        best_orig  = None
        for orig_id, (orig_toks, orig_name) in orig_tokens.items():
            score = jaccard(mz_toks, orig_toks)
            if score > best_score:
                best_score = score
                best_orig  = (orig_id, orig_name)

        if best_orig and best_score >= threshold:
            orig_id, orig_name = best_orig
            print(f'  ✂ [{best_score:.2f}] {mz_id}: "{mz_name[:45]}"  →  "{orig_name[:45]}"')
            if not dry_run:
                do_edit_merge(edits, rTags, notes_db,
                              f'center_{mz_id}', f'center_{orig_id}')
            remove_ids.add(mz_id)
            tehran_removed += 1
        elif best_orig and inc_medium and best_score >= 0.5:
            medium_matches.append((best_score, mz_id, mz_name, best_orig[0], best_orig[1], 'tehran'))

    if not dry_run:
        CENTERS[:] = [c for c in CENTERS if c.get('id') not in remove_ids]
    print(f'  تهران: {tehran_removed} تکراری یافت شد')

    if medium_matches:
        print(f'\n  [MEDIUM confidence — not auto-merged, --medium flag shows only]:')
        for score, mid, mname, oid, oname, _ in medium_matches[:20]:
            print(f'    [{score:.2f}] {mid}: "{mname[:40]}"  →  "{oname[:40]}"')

    # ── 2. PROVINCES ──────────────────────────────────────────────────────────
    print('\n=== استان‌ها ===')
    prov_medium = []

    for pname, prov_id in PROVINCE_MAP.items():
        arr = PC_RAW.get(pname, [])
        if not arr:
            continue

        originals = {}  # norm_name → (index, tokens)
        dupes = []

        for i, r in enumerate(arr):
            rname = center_name(r)
            if not rname:
                continue
            rtoks = tokenize(rname)

            if is_mizito(r):
                best_score = 0.0
                best_orig_name = None
                best_orig_idx  = None

                for orig_name, (orig_idx, orig_toks) in originals.items():
                    score = jaccard(rtoks, orig_toks)
                    if score > best_score:
                        best_score = score
                        best_orig_name = orig_name
                        best_orig_idx  = orig_idx

                if best_orig_name and best_score >= threshold:
                    orig_row = center_row(arr[best_orig_idx])
                    mz_row   = center_row(r)
                    src_key  = f'pc_{prov_id}||{mz_row}'
                    tgt_key  = f'pc_{prov_id}||{orig_row}'
                    print(f'  ✂ [{best_score:.2f}] [{pname}] "{rname[:40]}"  →  "{best_orig_name[:40]}"')
                    if not dry_run:
                        do_edit_merge(edits, rTags, notes_db, src_key, tgt_key)
                    dupes.append(i)
                    prov_removed += 1
                elif best_orig_name and inc_medium and best_score >= 0.5:
                    prov_medium.append((best_score, pname, rname, best_orig_name))
                    originals[rname] = (i, rtoks)
                else:
                    originals[rname] = (i, rtoks)
            else:
                originals[rname] = (i, rtoks)

        if dupes and not dry_run:
            dupe_set = set(dupes)
            PC_RAW[pname] = [r for i, r in enumerate(arr) if i not in dupe_set]
            for new_i, r in enumerate(PC_RAW[pname]):
                if isinstance(r, dict):
                    r['row'] = new_i

    print(f'  استان‌ها: {prov_removed} تکراری یافت شد')

    if prov_medium:
        print(f'\n  [MEDIUM confidence provinces]:')
        for score, pname, rname, oname in prov_medium[:30]:
            print(f'    [{score:.2f}] [{pname}] "{rname[:40]}"  →  "{oname[:40]}"')

    # ── Summary ───────────────────────────────────────────────────────────────
    total = tehran_removed + prov_removed
    print(f'\n=== نتیجه ===')
    print(f'  تهران:    {tehran_removed} حذف')
    print(f'  استان‌ها: {prov_removed} حذف')
    print(f'  جمع:      {total} حذف')

    if dry_run:
        print('\nDRY RUN — ذخیره نشد')
        cur.close(); conn.close(); return

    if total == 0:
        print('تکراری یافت نشد.')
        cur.close(); conn.close(); return

    DB['edits']  = edits
    DB['rTags']  = rTags
    DB['notes']  = notes_db

    print('\nذخیره در دیتابیس...')
    cur.execute(
        "INSERT INTO centers_master (key,data,updated_at) VALUES ('CENTERS',%s,NOW()) "
        "ON CONFLICT (key) DO UPDATE SET data=%s,updated_at=NOW()",
        (json.dumps(CENTERS, ensure_ascii=False),) * 2)
    cur.execute(
        "INSERT INTO centers_master (key,data,updated_at) VALUES ('PC_RAW',%s,NOW()) "
        "ON CONFLICT (key) DO UPDATE SET data=%s,updated_at=NOW()",
        (json.dumps(PC_RAW, ensure_ascii=False),) * 2)
    cur.execute(
        "INSERT INTO app_data (key,value,updated_at,updated_by) VALUES ('main',%s,NOW(),'dedup_fuzzy') "
        "ON CONFLICT (key) DO UPDATE SET value=%s,updated_at=NOW(),updated_by='dedup_fuzzy'",
        (json.dumps(DB, ensure_ascii=False),) * 2)
    conn.commit()
    cur.close(); conn.close()
    print('✅ تمیزکاری کامل شد! سرور را ریستارت و hard-refresh بزنید.')


if __name__ == '__main__':
    main()
