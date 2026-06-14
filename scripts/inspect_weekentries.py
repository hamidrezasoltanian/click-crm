#!/usr/bin/env python3
"""
Show all weekEntries to diagnose why week plan appears empty.
Usage: python3 scripts/inspect_weekentries.py
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

    cur.execute("SELECT value FROM app_data WHERE key='main'")
    row = cur.fetchone()
    DB = row[0] if row else {}

    we = DB.get('weekEntries', {})
    print(f"Total weekEntries: {len(we)}\n")

    # Group by weekId
    by_week = {}
    for k, v in we.items():
        if ':::' in k:
            week_id = k.split(':::')[0]
        else:
            week_id = '(no week id)'
        by_week.setdefault(week_id, []).append((k, v))

    print(f"Weeks present: {sorted(by_week.keys())}\n")
    print("─" * 60)

    for week_id in sorted(by_week.keys(), reverse=True):
        entries = by_week[week_id]
        print(f"\n📅 Week: {week_id}  ({len(entries)} entries)")
        for k, v in sorted(entries, key=lambda x: x[1].get('scheduledDate','')):
            name = v.get('centerName', '?')
            owner = v.get('addedBy', '?')
            date = v.get('scheduledDate', '?')
            done = '✓' if v.get('done') else '○'
            atype = v.get('actionType', '?')
            rid = v.get('rid', '?')
            rtype = v.get('rtype', '?')
            print(f"  {done} {date} [{atype}] {name[:35]} — {owner}  ({rtype}/{rid})")

    # Also check what week IDs the frontend would generate today
    # Jalali date conversion (approximate for diagnosis)
    today = datetime.now()
    gy, gm, gd = today.year, today.month, today.day
    print(f"\n─" * 60)
    print(f"Today (Gregorian): {gy}/{gm:02d}/{gd:02d}")
    print(f"\nIf entries are from past weeks, they won't show in current week view.")
    print(f"The frontend generates weekId based on Jalali start-of-week (Saturday).")

    cur.close(); conn.close()

if __name__ == '__main__':
    main()
