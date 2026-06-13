#!/usr/bin/env python3
"""
Export center names for AI analysis.
Outputs two files:
  - export_tehran.txt   : all Tehran centers (c_ and mz_t_)
  - export_provinces.txt: all province centers per province

Usage:
    python3 scripts/export_centers.py
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

env = load_env()
conn = psycopg2.connect(
    host=env.get('PG_HOST','localhost'), port=int(env.get('PG_PORT','5432')),
    dbname=env.get('PG_DATABASE','atena_crm'), user=env.get('PG_USER','postgres'),
    password=env.get('PG_PASSWORD',''),
)
cur = conn.cursor()
cur.execute("SELECT key,data FROM centers_master WHERE key IN ('CENTERS','PC_RAW')")
cm = {r[0]:r[1] for r in cur.fetchall()}
CENTERS = cm.get('CENTERS',[])
PC_RAW  = cm.get('PC_RAW',{})
cur.close(); conn.close()

# ── Tehran ────────────────────────────────────────────────────────────────────
out_dir = os.path.dirname(os.path.abspath(__file__))
tehran_path = os.path.join(out_dir, 'export_tehran.txt')
with open(tehran_path, 'w', encoding='utf-8') as f:
    c_list  = [(c['id'], norm(c.get('name',''))) for c in CENTERS if not c.get('id','').startswith('mz_t_')]
    mz_list = [(c['id'], norm(c.get('name',''))) for c in CENTERS if c.get('id','').startswith('mz_t_')]
    f.write(f'# مراکز اصلی تهران: {len(c_list)}\n')
    for cid, name in sorted(c_list, key=lambda x: x[1]):
        f.write(f'{cid}\t{name}\n')
    f.write(f'\n# مراکز میزیتو تهران: {len(mz_list)}\n')
    for cid, name in sorted(mz_list, key=lambda x: x[1]):
        f.write(f'{cid}\t{name}\n')

print(f'تهران: {len(c_list)} اصلی + {len(mz_list)} میزیتو → {tehran_path}')

# ── Provinces ─────────────────────────────────────────────────────────────────
prov_path = os.path.join(out_dir, 'export_provinces.txt')
with open(prov_path, 'w', encoding='utf-8') as f:
    total = 0
    for pname, prov_id in PROVINCE_MAP.items():
        arr = PC_RAW.get(pname, [])
        if not arr: continue
        orig = []
        miz  = []
        for i, r in enumerate(arr):
            n = norm(r.get('name','') if isinstance(r,dict) else (r[1] if len(r)>1 else ''))
            row = r.get('row', r.get('n', i)) if isinstance(r,dict) else r[0]
            key = f'pc_{prov_id}||{row}'
            if isinstance(r,dict) and r.get('_mizito'):
                miz.append((key, n))
            else:
                orig.append((key, n))
        f.write(f'\n## {pname} ({prov_id}) — اصلی:{len(orig)}  میزیتو:{len(miz)}\n')
        for k,n in sorted(orig, key=lambda x: x[1]):
            f.write(f'O\t{k}\t{n}\n')
        for k,n in sorted(miz, key=lambda x: x[1]):
            f.write(f'M\t{k}\t{n}\n')
        total += len(orig) + len(miz)

print(f'استان‌ها: {total} مرکز → {prov_path}')
print(f'\nحالا این دو فایل را برای آنالیز به Claude بفرستید:')
print(f'  {tehran_path}')
print(f'  {prov_path}')
