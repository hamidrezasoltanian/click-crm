#!/usr/bin/env python3
"""
Analyze export_tehran.txt to find mz_t_ → c_ duplicate candidates.
Works on the exported TXT file directly (no DB needed).

Usage:
    python3 scripts/analyze_export_dupes.py /path/to/export_tehran.txt
"""
import re, sys, os

def norm(s):
    s = (s or '').strip().replace('ي','ی').replace('ك','ک')
    s = re.sub(r'[‌‍‌-‏]','',s)
    return re.sub(r'\s+',' ',s).strip()

ORG_PREFIXES = [
    'شرکت','موسسه','سازمان','مجموعه','مجتمع','پژوهشگاه','دانشگاه',
    'پژوهشکده','فروشگاه','بیمارستان','بیمارستانی',
    'مرکز طبی','مرکز','کلینیک','درمانگاه','داروخانه','پلیکلینیک',
    'تجهیزات پزشکی','تصویربرداری','رادیولوژی','سونوگرافی',
    'آزمایشگاه','انجمن',
]

def strip_org(s):
    for p in sorted(ORG_PREFIXES, key=len, reverse=True):
        s = re.sub(r'^'+p+r'\s*','',s)
    return s.strip()

def core_name(s):
    s = strip_org(norm(s))
    s = re.sub(r'\s*\([^)]*\)\s*$','',s)
    s = re.sub(r'\s*-.*$','',s)
    return s.strip()

def trigram_sim(a, b):
    def tg(s):
        s = re.sub(r'\s','',s)
        return set(s[i:i+3] for i in range(len(s)-2)) if len(s) >= 3 else set(s)
    ta, tb = tg(a), tg(b)
    if not ta and not tb: return 1.0
    if not ta or not tb: return 0.0
    return len(ta & tb) / len(ta | tb)

def is_true_duplicate(mz_name, c_name):
    mn = norm(mz_name)
    cn = norm(c_name)

    if mn == cn:
        return True, 'exact'

    if re.sub(r'\s','',mn) == re.sub(r'\s','',cn):
        return True, 'exact-nospace'

    mc = core_name(mn)
    cc = core_name(cn)

    if mc and cc and len(mc) >= 4:
        if mc == cc:
            ratio = len(mn)/max(len(cn),1)
            if 0.35 <= ratio <= 3.0:
                return True, f'core-exact (ratio={ratio:.2f})'

        if len(mc) >= 6 and mc in cc:
            ratio = len(mn)/max(len(cn),1)
            if ratio >= 0.35:
                return True, f'core-sub (ratio={ratio:.2f})'
        if len(cc) >= 6 and cc in mc:
            ratio = len(mn)/max(len(cn),1)
            if ratio >= 0.35:
                return True, f'core-sub-rev (ratio={ratio:.2f})'

    len_ratio = len(mn) / max(len(cn), 1)
    if len(cn) >= 6 and cn in mn and len_ratio >= 0.45:
        return True, f'sub-c-in-mz (ratio={len_ratio:.2f})'
    if len(mn) >= 6 and mn in cn and len_ratio >= 0.45:
        return True, f'sub-mz-in-c (ratio={len_ratio:.2f})'

    # trigram high similarity
    tg = trigram_sim(mc or mn, cc or cn)
    if tg >= 0.72 and 0.4 <= len_ratio <= 2.5:
        return True, f'trigram={tg:.2f} (ratio={len_ratio:.2f})'

    return False, ''

def parse_file(path):
    c_list, mz_list = [], []
    section = None
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if line.startswith('# مراکز اصلی'):
                section = 'c'
                continue
            if line.startswith('# مراکز میزیتو'):
                section = 'mz'
                continue
            if not line.strip() or line.startswith('#'):
                continue
            parts = line.split('\t', 1)
            if len(parts) == 2:
                cid, name = parts
                if section == 'c':
                    c_list.append((cid.strip(), norm(name)))
                elif section == 'mz':
                    mz_list.append((cid.strip(), norm(name)))
    return c_list, mz_list

def main():
    if len(sys.argv) < 2:
        # Try default location
        path = os.path.join(os.path.dirname(__file__), 'export_tehran.txt')
        if not os.path.exists(path):
            print('Usage: python3 analyze_export_dupes.py /path/to/export_tehran.txt')
            sys.exit(1)
    else:
        path = sys.argv[1]

    c_list, mz_list = parse_file(path)
    print(f'c_: {len(c_list)} | mz_t_: {len(mz_list)}\n')

    # Already-confirmed pairs (skip these)
    ALREADY = {
        'mz_t_87','mz_t_112','mz_t_11','mz_t_839','mz_t_1096','mz_t_1185',
        'mz_t_1718','mz_t_1780','mz_t_1874','mz_t_2673','mz_t_2976',
        'mz_t_3935','mz_t_4042','mz_t_4357','mz_t_4392','mz_t_4396',
        'mz_t_4727','mz_t_4915','mz_t_4947',
    }

    pairs = []
    for mz_id, mz_name in mz_list:
        if mz_id in ALREADY:
            continue
        for c_id, c_name in c_list:
            ok, reason = is_true_duplicate(mz_name, c_name)
            if ok:
                pairs.append((mz_id, mz_name, c_id, c_name, reason))
                break

    print(f'=== جفت‌های احتمالی تکراری (پس از حذف ۱۹ تایید شده): {len(pairs)} ===\n')

    # Group by reason type for review
    exact, core_ex, core_sub, sub, tg_sim = [], [], [], [], []
    for p in pairs:
        r = p[4]
        if 'exact' in r and 'core' not in r and 'nospace' not in r:
            exact.append(p)
        elif 'nospace' in r or ('exact' in r and 'core' not in r):
            exact.append(p)
        elif 'core-exact' in r:
            core_ex.append(p)
        elif 'core-sub' in r:
            core_sub.append(p)
        elif 'sub-' in r:
            sub.append(p)
        else:
            tg_sim.append(p)

    def show(group, title):
        if not group: return
        print(f'── {title} ({len(group)}) ──────────────────')
        for mz_id, mz_name, c_id, c_name, reason in sorted(group, key=lambda x: x[1]):
            print(f"  ('{mz_id}', '{c_id}', '{reason[:40]}'),")
            print(f"    mz: {mz_name[:60]}")
            print(f"    c_: {c_name[:60]}")
        print()

    show(exact,    'EXACT (نام کاملاً یکسان)')
    show(core_ex,  'CORE EXACT (بعد از حذف پیشوند)')
    show(core_sub,  'CORE SUB (زیررشته core)')
    show(sub,      'SUBSTRING (زیررشته مستقیم)')
    show(tg_sim,   'TRIGRAM HIGH (شباهت بالا)')

    print(f'\nجمع: {len(pairs)} کاندید')

if __name__ == '__main__':
    main()
