# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Name

**Flow CRM** — Persian-language (RTL, Jalali calendar) CRM for a medical equipment sales team.

## Running the App

```bash
# Development server (Node.js + PostgreSQL backend)
cd /home/user/Sales-Portal && node server/index.js
# then open http://localhost:3000

# Or serve static only (no backend persistence)
python3 -m http.server 8080
# then open http://localhost:8080/public/index.html
```

## File Structure

```
Sales-Portal/
  public/
    index.html          ← main app (~13 000 lines, single-file)
    sw.js               ← service worker (CDN caching)
    fonts/              ← Vazirmatn font files
  server/
    index.js            ← Express entry point (port 3000)
    db.js               ← PostgreSQL pool (pg)
    auth.js             ← cookie-session auth
    routes/
      auth.js           ← /api/auth  (login/logout)
      data.js           ← /api/data/db  (main DB blob PUT/GET)
      contacts.js       ← /api/contacts/:key
      pricing.js        ← /api/pricing
      audit.js          ← /api/audit  (field change log)
      events.js         ← /api/events (SSE broadcast)
      users.js          ← /api/users
      distribution.js   ← /api/distribution
      ai.js             ← /api/ai proxy
  atena_crm_v3_mtr_3.html  ← kept identical to public/index.html (legacy copy)
  CLAUDE.md
```

**Both files must always be kept in sync:**
```bash
cp public/index.html atena_crm_v3_mtr_3.html
```

## Architecture

The entire frontend is a **single HTML file** (`public/index.html`) combining all CSS, HTML markup, and JavaScript. There are no build tools, bundlers, or package managers on the frontend.

### Data Layer

| Store | Key / Table | Contents |
|---|---|---|
| PostgreSQL `app_data` | `'main'` | Entire `DB` object as JSON |
| PostgreSQL `app_data` | `'mtr'` | Receivables module data |
| PostgreSQL `center_contacts` | center_key | Legacy single-contact per center |
| PostgreSQL `centers_master` | `'CENTERS'` / `'PC_RAW'` | Master center lists |
| `localStorage` `atena_crm_v2` | — | Client-side cache of `DB` |
| IndexedDB `atenaCRM_master` | — | Master center list cache |

**The primary store is PostgreSQL.** `localStorage` is a fallback/cache.

The main `DB` object contains:
```
edits, notes, tags, rTags, weekTags, weekEntries, events, checklist,
extra, settings, kpiTargets, callLog, visitLog, salesLog, missionLog,
provHistory, mtrFollower, mtrFollowerMap, changeLog, mtrTrend,
notifications, tasks
```

**Reading/writing center fields** goes through `getE(type, id)` / `setE(type, id, field, val)`.
- `DB.edits` holds per-center overrides keyed as `"{type}_{id}"`.
- `type` is `'center'` for Tehran centers, `'pc'` for all other provinces.
- `setE` triggers `saveDB()` (debounced 300 ms → PUT `/api/data/db`).

### Global State Variables

| Variable | Meaning |
|---|---|
| `currentUser` | Active user ID e.g. `'Sarah.hosseini'` |
| `currentTab` | Active tab: `'provinces'` \| `'weekplan'` \| `'calendar'` \| `'checklist'` \| `'activity'` \| `'kpi'` \| `'tasks'` \| `'changelog'` \| `'manager'` \| `'mtr'` \| `'pricing'` |
| `_currentProvId` | `null` = province list; province ID = centers view |
| `_viewMode` | Centers view: `'list'` \| `'kanban'` \| `'card'` |
| `_provView` | Province list: `'grid'` \| `'list'` \| `'kanban'` |

### Main Tabs / Panels

1. **استان‌ها** — Province grid → centers with list/kanban/card views
2. **برنامه هفته** — 7-day Jalali weekly grid for scheduled visits
3. **تقویم** — Month/week/list Jalali event calendar
4. **چک‌لیست روزانه** — Daily scored checklist
5. **فعالیت‌ها** — Read-only log of calls, visits, sales
6. **KPI** — Manager dashboard (manager-only)
7. **📌 وظایف** — Task management (all users)
8. **🗃 لاگ تغییرات** — Change log (manager-only)
9. **مطالبات** — Receivables module (semi-independent)
10. **قیمت‌گذاری** — Pricing module

### Initialization

`init()` called on `DOMContentLoaded`:
1. `loadDB()` — fetch from `/api/data/db`, fall back to localStorage
2. `loadMasterCenters()` — fetch from `/api/data/centers/master` → IndexedDB cache
3. `initSettings()`, `buildUSERS()`
4. `switchTab(currentTab)`, `_initNotif()`, `_initOnboarding()`

### Jalali Calendar

All dates are Persian/Solar Hijri:
- `g2j(gy, gm, gd)` → `[jy, jm, jd]`
- `j2g(jy, jm, jd)` → `[gy, gm, gd]`
- `todayStr()` → `'YYYY/MM/DD'`
- `jMs(jy, jm, jd)` → Unix ms timestamp

### Users & Permissions

- `_DEFAULT_MEMBERS`: `Sarah.hosseini` (مدیر), `Reyhane.kashisaz`, `Mohammad.seyedsalehi`, `Rambod.ghasemi` (کارشناس فروش), `guest`
- `_isManager()` — checks `'مدیر'` role
- `_isExpert()` — checks `'کارشناس فروش'` role

### Key Features Added (recent sessions)

| Feature | Description |
|---|---|
| `DB.changeLog` | Array of `{at, by, rkey, field, val}` — full field-change history |
| `DB.notifications` | In-app notification bell with ack, center links |
| `DB.tasks` | Task management `{id, title, owner, dueDate, priority, centerKey, done}` |
| Auto-reminders | Centers with no date or overdue dates notify experts at startup |
| Pipeline Matrix | Manager panel: potential × status center count grid |
| Center Timeline | `openCenterAudit()` — local timeline from changeLog + notes + weekEntries + tasks |
| Structured logging | Done modal captures نتیجه / یادداشت / اقدام بعدی on week-plan completion |
| Onboarding | 7-day tutorial widget, dismissible, re-enableable from Settings |

### Critical Edit Constraint

The file contains **non-breaking spaces (`\xa0`)** mixed in indented lines.
**NEVER use the Edit tool directly on this file** — it will fail silently or corrupt the file.

**Always use Python scripts:**
```python
with open(FILEPATH, 'r', encoding='utf-8') as f:
    content = f.read()
# use content.replace() or line-index insertion
with open(FILEPATH, 'w', encoding='utf-8') as f:
    f.write(content)
```

To inspect an exact line before replacing:
```bash
python3 -c "
with open('public/index.html','r',encoding='utf-8') as f:
    lines=f.readlines()
print(repr(lines[LINE_IDX]))  # 0-indexed
"
```

### Key Helper Functions

| Function | Purpose |
|---|---|
| `esc(s)` | HTML-escape for safe innerHTML insertion |
| `fNorm(s)` | Normalize Persian text for search |
| `showToast(msg, dur)` | Global toast notification |
| `openModal(id, title, body, footer, opts)` | Generic modal — `opts.lg` for large |
| `saveDB()` | Debounced 300 ms → PUT `/api/data/db` |
| `saveDBSync()` | Immediate save |
| `setE(type, id, field, val)` | Write center field → changeLog → saveDB |
| `getE(type, id)` | Read center edit object |
| `_isManager()` / `_isExpert()` | Role checks |
| `_getCenterName(type, id)` | Get display name for a center |
| `sendNotif(toUser, message, centerKey)` | Send in-app notification |

### External Dependencies (CDN only)

- **Vazirmatn font** — `cdn.jsdelivr.net/npm/vazirmatn@33.003.0`
- **SheetJS/xlsx** — `cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`

### AI Feature

The receivables AI tab calls `https://api.anthropic.com/v1/messages` directly from the browser using model `claude-sonnet-4-20250514`. API key provided by user at runtime.
