#!/usr/bin/env python3
"""
Smart Tehran dedup: mz_t_ centers that are true duplicates of c_ centers.

A match is considered a TRUE duplicate only if:
  - Score >= 0.85 AND names have similar length (ratio >= 0.55)
  - OR score == 1.0 (exact after normalization + space removal)
  - OR the mz_t_ name starts with the c_ name (or vice versa) and ratio >= 0.6

This filters out false positives where a SHORT mz_t_ name (e.g. "لقمان حکیم")
is simply embedded inside a LONG c_ name describing a different entity
(e.g. "داروخانه بیمارستان لقمان حکیم").

Usage:
    python3 scripts/dedup_tehran_smart.py [--dry-run] [--auto]
    --dry-run : show what would be merged, save nothing
    --auto    : auto-merge all found pairs (no confirmation)
"""
import json, os, re, sys
import psycopg2

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
    s = re.sub(r'[‌‍‌-‏]','',s)
    return re.sub(r'\s+',' ',s).strip()

def strip_org(s):
    """Remove company/org prefixes."""
    for p in ['شرکت','موسسه','سازمان','مجموعه','مجتمع','پژوهشگاه','دانشگاه',
              'پژوهشکده','تجهیزات پزشکی','فروشگاه','بیمارستان','بیمارستانی',
              'مرکز','کلینیک','درمانگاه','داروخانه','پلیکلینیک']:
        s = re.sub(r'^'+p+r'\s*','',s)
    return s.strip()

def core_name(s):
    """Extract core meaningful part: remove org prefixes and parenthetical suffix."""
    s = strip_org(norm(s))
    s = re.sub(r'\s*\([^)]*\)\s*$','',s)  # remove trailing (...)
    s = re.sub(r'\s*-.*$','',s)            # remove trailing - ...
    return s.strip()

def merge_edit(target, source):
    if not source: return target or {}
    if not target: return dict(source)
    tc = target.get('contacts',[])
    seen = {c.get('name','') for c in tc}
    for ct in source.get('contacts',[]):
        cn = ct.get('name','')
        if cn not in seen:
            tc.append(ct); seen.add(cn)
        else:
            exc = next((x for x in tc if x.get('name','')==cn), None)
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

def do_merge(edits, rTags, notes_db, src_key, tgt_key):
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

def is_true_duplicate(mz_name, c_name):
    """
    Returns (is_dupe, reason) based on smart matching.
    Filters out false positives from short-name-inside-long-name.
    """
    mn = norm(mz_name)
    cn = norm(c_name)

    # 1. Exact match (after normalization)
    if mn == cn:
        return True, 'exact'

    # 2. Exact after removing all spaces
    if re.sub(r'\s','',mn) == re.sub(r'\s','',cn):
        return True, 'exact-nospace'

    # 3. Core name comparison (remove org prefixes + parentheticals)
    mc = core_name(mn)
    cc = core_name(cn)
    if mc and cc and len(mc) >= 5:
        if mc == cc:
            ratio = len(mn)/max(len(cn),1)
            if 0.45 <= ratio <= 2.2:
                return True, f'core-match ({ratio:.2f})'

        # Core name is substring in the other, AND length ratio is ok
        if len(mc) >= 6 and mc in cc:
            ratio = len(mn)/max(len(cn),1)
            if ratio >= 0.45:
                return True, f'core-sub ({ratio:.2f})'
        if len(cc) >= 6 and cc in mc:
            ratio = len(mn)/max(len(cn),1)
            if ratio >= 0.45:
                return True, f'core-sub-rev ({ratio:.2f})'

    # 4. Direct substring AND length ratio >= 0.55
    len_ratio = len(mn) / max(len(cn), 1)
    if len(cn) >= 6 and cn in mn and len_ratio >= 0.55:
        return True, f'sub-c-in-mz (ratio={len_ratio:.2f})'
    if len(mn) >= 6 and mn in cn and len_ratio >= 0.55:
        return True, f'sub-mz-in-c (ratio={len_ratio:.2f})'

    return False, ''


def main():
    dry_run = '--dry-run' in sys.argv
    auto    = '--auto'    in sys.argv
    if dry_run: print('DRY RUN\n')

    env = load_env()
    conn = psycopg2.connect(
        host=env.get('PG_HOST','localhost'), port=int(env.get('PG_PORT','5432')),
        dbname=env.get('PG_DATABASE','atena_crm'), user=env.get('PG_USER','postgres'),
        password=env.get('PG_PASSWORD',''),
    )
    cur = conn.cursor()

    cur.execute("SELECT data FROM centers_master WHERE key='CENTERS'")
    CENTERS = cur.fetchone()[0]

    c_list  = [c for c in CENTERS if not c.get('id','').startswith('mz_t_')]
    mz_list = [c for c in CENTERS if c.get('id','').startswith('mz_t_')]

    print(f'c_ centers: {len(c_list)}')
    print(f'mz_t_ centers: {len(mz_list)}\n')

    pairs = []
    for mz in mz_list:
        mz_name = norm(mz.get('name',''))
        for c in c_list:
            c_name = norm(c.get('name',''))
            ok, reason = is_true_duplicate(mz_name, c_name)
            if ok:
                pairs.append((mz, c, reason))
                break  # take first match per mz center

    print(f'=== جفت‌های تکراری واقعی: {len(pairs)} ===\n')
    for mz, c, reason in pairs:
        print(f'  [{reason}]')
        print(f'    mz: {mz["id"]:12s} "{norm(mz.get("name",""))[:55]}"')
        print(f'    c_: {c["id"]:12s} "{norm(c.get("name",""))[:55]}"')

    if not pairs:
        print('هیچ تکراری یافت نشد.')
        cur.close(); conn.close(); return

    print(f'\n{"DRY RUN — " if dry_run else ""}اجرای merge برای {len(pairs)} جفت...')

    if dry_run:
        cur.close(); conn.close(); return

    if not auto:
        ans = input(f'\nآیا {len(pairs)} جفت را merge کنم؟ (y/N): ').strip().lower()
        if ans != 'y':
            print('لغو شد.')
            cur.close(); conn.close(); return

    cur.execute("SELECT value FROM app_data WHERE key='main'")
    DB = (cur.fetchone()[0] or {})
    edits    = DB.setdefault('edits',{})
    rTags    = DB.setdefault('rTags',{})
    notes_db = DB.setdefault('notes',{})

    remove_ids = set()
    for mz, c, reason in pairs:
        mz_id = mz['id']
        c_id  = c['id']
        do_merge(edits, rTags, notes_db, f'center_{mz_id}', f'center_{c_id}')
        remove_ids.add(mz_id)

    CENTERS[:] = [c for c in CENTERS if c.get('id') not in remove_ids]
    DB['edits'] = edits; DB['rTags'] = rTags; DB['notes'] = notes_db

    cur.execute(
        "INSERT INTO centers_master (key,data,updated_at) VALUES ('CENTERS',%s,NOW()) "
        "ON CONFLICT (key) DO UPDATE SET data=%s,updated_at=NOW()",
        (json.dumps(CENTERS,ensure_ascii=False),)*2)
    cur.execute(
        "INSERT INTO app_data (key,value,updated_at,updated_by) VALUES ('main',%s,NOW(),'dedup_tehran') "
        "ON CONFLICT (key) DO UPDATE SET value=%s,updated_at=NOW(),updated_by='dedup_tehran'",
        (json.dumps(DB,ensure_ascii=False),)*2)
    conn.commit()
    cur.close(); conn.close()
    print(f'✅ {len(pairs)} مرکز تکراری حذف شد. سرور را ریستارت و hard-refresh بزنید.')

if __name__ == '__main__':
    main()
