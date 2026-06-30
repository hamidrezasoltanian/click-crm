# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
It is the single source of truth for an AI to understand the entire app and its future plan — keep it updated after every significant change.

## Project Name

**Click CRM** — Persian-language (RTL, Jalali calendar) CRM for a medical equipment sales team (~5 users).
Vanilla JS frontend + Express/PostgreSQL backend. Vite + TypeScript + Vue 3 scaffold added in `src/` for incremental migration (no build step yet — new components will be compiled to `public/dist/` and loaded alongside existing vanilla JS).

## Running the App

```bash
# Development server (Node.js + PostgreSQL backend)
cd /home/user/Sales-Portal && node server/index.js
# then open http://localhost:3000

# Syntax check after any JS edit (mandatory):
node --check public/js/app.bundle.js
```

## File Structure

```
Sales-Portal/
  public/
    index.html              ← HTML shell: markup, tab buttons, panel divs
    css/app.css             ← all styles (~1,640 lines), indigo design system
    js/
      app.bundle.js         ← MAIN app file (15,292 lines) — served to browser
                              ⚠ has NBSP (\xa0) — ALWAYS edit via Python, NEVER Edit tool
                              ⚠ is a bundle of all the module files below
      app.js                ← legacy single-file (NOT loaded) — kept for reference only
      proforma.js           ← proforma invoice module (~650 lines)
      modules/              ← extracted module files (organized copies, loaded before bundle)
        auth-ui.js          ← login/logout UI
        storage.js          ← loadDB, saveDB, SSE sync
        user-mgmt.js        ← user CRUD, province ownership
        tab-nav.js          ← switchTab, openProvince, navigation
        banner.js           ← followup alerts, recent activity
        week-plan.js        ← weekly schedule, drag-drop
        notifications.js    ← bell panel, notification helpers
      core/                 ← pure utility modules (no side effects)
        jalali.js           ← Jalali date conversion (g2j, j2g, todayStr, ...)
        helpers.js          ← esc, fNorm, showToast, flashRow
        modal.js            ← openModal, closeModal, showContactPopup
        date-picker.js      ← openJDP, buildJDP
      [other module files]  ← activity.js, calendar.js, center-modal.js, checklist.js,
                              dashboard.js, kpi.js, manager.js, manager-tasks.js,
                              mtr.js, onboarding.js, pricing.js, provinces.js,
                              settings.js, tasks.js, ui-core.js, weekplan.js
    wms.html                ← WMS warehouse app (served at /wms); uses REST endpoints;
                              includes proforma sub-module (list/version/payments/reports UI)
    letters.html             ← دبیرخونه (letters/correspondence) standalone app (served at /letters);
                              Quill WYSIWYG editor, print template, canvas signature, letterhead
    admin.html                ← SVG-based visual workflow designer (served at /admin, manager-only)
    sw.js                   ← service worker (CDN caching)
    fonts/                  ← Vazirmatn font files
  src/                      ← Vue 3 + TypeScript (Vite builds → public/dist/)
    main.ts                 ← placeholder entry point
  server/
    index.js                ← Express entry point (port 3000); helmet + compression
    db.js                   ← PostgreSQL pool (pg) + initSchema() for all tables
    auth.js                 ← cookie-session auth
    bot/
      telegram.js           ← Telegram long-polling bot (proforma approve/reject, inventory, QR scan)
    routes/
      auth.js               ← /api/auth  (login/logout)
      data.js               ← /api/data/db  (main DB blob PUT/GET)
      contacts.js           ← /api/contacts/:key
      pricing.js            ← /api/pricing
      audit.js              ← /api/audit  (field change log)
      events.js             ← /api/events (SSE broadcast)
      users.js              ← /api/users
      distribution.js       ← /api/distribution
      ai.js                 ← /api/ai proxy
      discovery.js          ← /api/discovery (biopsy center discovery: list, ai-scan, import-file)
      wms.js                ← /api/wms  (full REST CRUD: products, warehouses, lots, transactions, POs)
      proforma.js           ← /api/proforma  (CRUD + workflow actions, SQL-backed, zod validated)
      tasks.js              ← /api/tasks  (SQL-backed task CRUD)
      week-entries.js       ← /api/week-entries  (SQL-backed week schedule)
      notifications.js      ← /api/notifications  (SQL-backed)
      changelog.js          ← /api/changelog  (SQL-backed)
      migrate.js            ← /api/migrate/blob-to-sql  (one-shot blob→SQL migration)
      hr.js, trade-kpi.js, payroll.js, invoices.js, reports.js, faradis.js,
      faradis-match.js, faradis-data.js, support.js, missions.js, hcps.js, files.js
                             ← see individual route files; mounted in server/index.js
      letters.js             ← /api/letters  (دبیرخونه: CRUD, atomic indicator numbering
                              via letter_indicator_seq, referrals/کارتابل, templates)
      wms-proforma.js        ← /api/wms-proforma  (CRUD + send/approve/reject/cancel/reopen
                              workflow + issue-voucher; versioning via POST /:id/revise
                              (root_id/parent_id/version/is_latest); commission snapshot on
                              approve (owner_at_approval/commission_pct_snapshot/
                              commission_amount_snapshot, immutable, cleared on reopen);
                              receivables (GET /receivables) + payments (POST/GET
                              /:id/payments); reports (GET /report/by-user,
                              GET /report/by-product); low-stock enrichment (enrichStock)
                              on list + single-fetch)
      admin.js                ← /api/admin  (workflow designer config, manager-only)
  scripts/
    discover_centers.py ← CLI scraper (nobat.ir, doctorto.ir, --ai, --enrich modes)
  vite.config.ts        ← Vite 6 config: Vue plugin, src/ → public/dist/, dev proxy → :3000
  tsconfig.json         ← strict ES2022 TypeScript config
  atena_crm_v3_mtr_3.html  ← legacy snapshot of the OLD single-file app (frozen; kept for history)
  CLAUDE.md
```

> History note: the frontend used to be one giant HTML file. It was split into
> `index.html` + `css/app.css` + `js/app.js` (commit `cfc5741`). All new work goes
> into the split files. `atena_crm_v3_mtr_3.html` is a frozen legacy copy.

## ⚠️ Critical Edit Constraint

`public/js/app.bundle.js` (the main frontend file) contains **non-breaking spaces (`\xa0`)** mixed into indented lines, plus deeply nested quote-escaping inside HTML-string templates.
**NEVER use the Edit tool directly on this file** — exact-match will fail or corrupt content.

**Always use Python scripts:**
```python
with open('public/js/app.bundle.js', 'r', encoding='utf-8') as f:
    content = f.read()
# use content.replace(old, new, 1) with exact strings verified via repr()
with open('public/js/app.bundle.js', 'w', encoding='utf-8') as f:
    f.write(content)
```

To inspect an exact line before replacing (0-indexed):
```bash
python3 -c "
with open('public/js/app.bundle.js','r',encoding='utf-8') as f:
    lines=f.readlines()
print(repr(lines[LINE_IDX]))
"
```

**Quote-escaping rule for generated HTML:** most UI is built as JS strings with
`onclick="fn(\''+var+'\')"` patterns. When writing such strings from Python, the
JS source must contain `\\'` (backslash-quote) inside the double-quoted HTML
attribute. Always run `node --check public/js/app.bundle.js` after editing.

## Architecture

### Data Layer

| Store | Key / Table | Contents |
|---|---|---|
| PostgreSQL `app_data` | `'main'` | Entire `DB` object as JSON |
| PostgreSQL `app_data` | `'mtr'` | Receivables module data |
| PostgreSQL `center_contacts` | center_key | Legacy single-contact per center |
| PostgreSQL `centers_master` | `'CENTERS'` / `'PC_RAW'` | Master center lists |
| PostgreSQL `proformas` | — | Proforma invoices (proper table, zod validated) |
| PostgreSQL `wms_products` | — | WMS product catalog |
| PostgreSQL `wms_warehouses` | — | WMS warehouses |
| PostgreSQL `wms_counterparties` | — | WMS suppliers / customers |
| PostgreSQL `wms_lots` | — | WMS lot/batch records |
| PostgreSQL `wms_transactions` | — | WMS entry/exit transactions |
| PostgreSQL `wms_purchase_orders` | — | WMS purchase orders (JSONB items) |
| PostgreSQL `wms_recalls` | — | WMS product recalls |
| PostgreSQL `wms_audit_log` | — | WMS immutable audit trail |
| PostgreSQL `wms_proformas` | — | WMS proforma invoices; versioned (`root_id`/`parent_id`/`version`/`is_latest`); commission snapshot (`owner_at_approval`, `commission_pct_snapshot`, `commission_amount_snapshot`) frozen at `approve` |
| PostgreSQL `wms_proforma_payments` | — | Payments recorded against approved/voucher_issued proformas (full or partial) — receivables (مطالبات) are derived from this + `wms_proformas`, no separate ledger table |
| PostgreSQL `letters` | — | دبیرخونه correspondence (outgoing/incoming/internal), atomic indicator numbering |
| PostgreSQL `letter_referrals` | — | کارتابل — letter referral chain (from→to user, read/complete status) |
| PostgreSQL `letter_templates` | — | Reusable letter templates |
| PostgreSQL `letter_indicator_seq` | (prefix, type_code, year_month) | Atomic per-month indicator-number counter (`INSERT ... ON CONFLICT DO UPDATE`) |
| PostgreSQL `wms_settings` | key | WMS key-value config |
| `localStorage` `atena_crm_v2` | — | Client-side cache of `DB` |
| IndexedDB `atenaCRM_master` | — | Master center list cache |

**The primary store is PostgreSQL.** `localStorage` is a fallback/cache.
The whole `DB` object is saved as one JSON blob — there is no per-record API; concurrency is last-write-wins with SSE refresh hints.

The main `DB` object contains:
```
edits, notes, tags, rTags, weekTags, weekEntries, events, checklist,
extra, settings, kpiTargets, callLog, visitLog, salesLog, missionLog,
provHistory, mtrFollower, mtrFollowerMap, changeLog, mtrTrend,
notifications, tasks, kpiHistory
```

Key sub-structures:

| Field | Shape | Notes |
|---|---|---|
| `DB.edits` | `{"{type}_{id}": {status, owner, potential, followupDate, lead, type, address, nameOverride, contacts[], competitor, biopsyScore, biopsyReasons, _ts, ...}}` | per-center overrides; the heart of the CRM |
| `DB.weekEntries` | `{"{weekId}:::{recKey}": {rtype, rid, scheduledDate, actionType:'call'|'visit', done, doneDate, addedBy, centerName, weekTagId}}` | week-plan assignments |
| `DB.tasks` | `[{id, title, owner, dueDate, priority(1-3), status, centerKey, note, subtasks[], done, doneAt, createdBy, createdAt}]` | kanban tasks; `subtasks` is recursive `{id,title,done,subtasks[]}` up to 3 levels |
| `DB.changeLog` | `[{at(ISO), by, rkey, field, val}]` | full field-change history; powers audit, drill-down, activity detection |
| `DB.notifications` | `[{id, to, msg, centerKey, at, read}]` | in-app bell notifications |
| `DB.notes` | `{"{rkey}": [note,...]}` | per-center notes |
| `DB.settings.members` | `[{id, name, role, active, color}]` | user list (managed in Settings) |
| `DB.settings.taskColumns` | `{"{userId}": [{id,label,color}]}` | per-user custom kanban columns (falls back to `_TK_STATUSES`) |

**Reading/writing center fields** goes through `getE(type, id)` / `setE(type, id, field, val)`.
- `type` is `'center'` for Tehran centers, `'pc'` for all other provinces.
- `pc` ids look like `"{provId}||{n}"`; province id = `rid.split('||')[0]`.
- `setE` appends to `DB.changeLog` and triggers `saveDB()` (debounced 300 ms → PUT `/api/data/db`).

**Owner resolution chain** (used everywhere a center's responsible expert is needed — keep all copies consistent):
1. `getE(rtype,id).owner` → 2. static center `owner` (CENTERS / `_PC_CACHE`) → 3. `DB.extra[].owner` → 4. `we.addedBy` (week entries only).
Canonical implementation: `_wpGetOwner(we)` (~line 5996). Inline copies exist in `renderWeekPlan` and `renderWpFullCenterList`.
Server-side equivalent (no `DB.extra`/`we.addedBy` access, used for the commission snapshot): `resolveCenterOwner(centerId)` in `server/routes/wms-proforma.js` — checks `center_edits.data->>'owner'` first, falls back to `centers_master` key=`'CENTERS'` JSON array.

### Global State Variables

| Variable | Meaning |
|---|---|
| `currentUser` | Active user ID e.g. `'Sarah.hosseini'` |
| `currentTab` | `'provinces'` \| `'weekplan'` \| `'calendar'` \| `'checklist'` \| `'activity'` \| `'kpi'` \| `'tasks'` \| `'changelog'` \| `'manager'` \| `'mtr'` \| `'pricing'` |
| `_currentProvId` | `null` = province list; province ID = centers view |
| `_viewMode` | Centers view: `'list'` \| `'kanban'` \| `'card'` |
| `_provView` | Province list: `'grid'` \| `'list'` \| `'kanban'` |
| `_taskView` / `_taskFilter` | Tasks tab: `'kanban'|'list'` / `'all'|'mine'|'overdue'` |
| `_notifViewAll` | Manager toggle: own vs. everyone's notifications |
| `_wpFclFilters` | `{q, owner, prov}` — week-plan full-center-list filters; `owner` is synced from `#wpOwnerFilter` |

### Main Tabs / Panels

1. **استان‌ها** — Province grid → centers with list/kanban/card views; recommendations widget (P1/P2 only)
2. **برنامه هفته** — 7-day Jalali weekly grid; drag-drop; expert filter (`#wpOwnerFilter`) applies to BOTH the day grid and the full center list below; progress bar; bulk move
3. **تقویم** — Month/week/list Jalali event calendar (also shows followup dates)
4. **چک‌لیست روزانه** — Daily scored checklist
5. **فعالیت‌ها** — Read-only log of calls, visits, sales
6. **KPI** — Manager dashboard (manager-only)
7. **📌 وظایف** — Monday-style kanban tasks (all users): drag-drop columns, per-user custom columns (⚙️ ستون‌ها), 3-level subtasks with inline add/edit, priority, owner, due date, center link
8. **🗃 لاگ تغییرات** — Change log (manager-only)
9. **بررسی مدیر** — Manager panel: summary cards, per-expert table (rows clickable → drill-down), pipeline matrix (potential × status), today summary; overdue numbers clickable → overdue list
10. **مطالبات** — Receivables module (semi-independent, key `'mtr'`)
11. **قیمت‌گذاری** — Pricing module (margin settings gated behind password)

### Initialization

`init()` (~line 8128) called on `DOMContentLoaded`:
1. `loadDB()` — fetch from `/api/data/db`, fall back to localStorage
2. `loadMasterCenters()` — fetch from `/api/data/centers/master` → IndexedDB cache
3. `initSettings()`, `buildUSERS()` (loads members from server → `USERS` map of id→display-name)
4. `switchTab(currentTab)`, `_initNotif()`, `_initOnboarding()`
5. Startup auto-reminders: centers with no followup date or overdue dates notify their experts

### Jalali Calendar

All dates are Persian/Solar Hijri, format `'YYYY/MM/DD'` (string comparison works for ordering):
- `g2j(gy, gm, gd)` → `[jy, jm, jd]` · `j2g(jy, jm, jd)` → `[gy, gm, gd]`
- `todayStr()` → `'YYYY/MM/DD'` · `jMs(jy, jm, jd)` → Unix ms · `p2(n)` → zero-pad
- `DB.changeLog[].at` is ISO Gregorian; convert with `g2j` when comparing to Jalali dates

### Users & Permissions

- Default members: `Sarah.hosseini` (مدیر), `Reyhane.kashisaz`, `Mohammad.seyedsalehi`, `Rambod.ghasemi` (کارشناس فروش), `guest`. Actual list lives in `DB.settings.members`, editable in Settings.
- `_isManager()` — checks `'مدیر'` role · `_isExpert()` — checks `'کارشناس فروش'` role
- Non-managers only see week-plan cards / center lists for centers they own.
- **Access password `62604193`** (checked ~line 2720): gates margin (حاشیه) display and pricing settings — required even for managers.

### Function Map (app.js, approximate line numbers)

| Line | Function | Purpose |
|---|---|---|
| 122 | `loadDB()` | fetch DB blob, localStorage fallback |
| 138 | `saveDB()` / `saveDBSync()` | debounced / immediate PUT `/api/data/db` |
| 323 | `umGetActive()` | active members list |
| 693 | `buildUSERS()` | build `USERS` id→name map |
| 858/879 | `getE` / `setE` | center field read/write (+changeLog) |
| 999 | `switchTab(tab)` | tab routing — single if/else chain; don't break it |
| ~1646 | `openPreCallBrief(rtype,rid)` | pre-call summary modal (status, last notes, changes, competitor, address) |
| ~1680 | `quickCallLog(rtype,rid,name)` | quick post-call log modal (result dropdown + note + next followup date) |
| ~1690 | `_submitQCL(rtype,rid,modalId)` | submit quickCallLog form → saves note + followupDate |
| ~1720 | `_renderExpertDash(el)` | expert dashboard; first section = ☀️ امروز من (today's week entries) |
| 1753 | `renderDashboard()` | provinces-tab dashboard widgets |
| 1796 | `renderBanner()` | top reminder banner (overdue/today followups) |
| 1907 | `renderTable()` | centers list view inside a province; each row has 🎯 pre-call button |
| 3159 | `openCenterAudit(key,name)` | center timeline modal (changeLog+notes+weekEntries+tasks) |
| 3231 | `openCenterModal(rtype,id)` | center edit modal: status, owner, followup date, competitor field, map button, commission div, 🎯 خلاصه footer button |
| 3839 | `renderWeekPlan()` | 7-day grid; syncs `#wpOwnerFilter` → `_wpFclFilters.owner` |
| 3961 | `renderWpFullCenterList()` | unscheduled queue + all-centers list below the grid |
| 4888 | `sendNotif(to,msg,centerKey)` | push in-app notification |
| 4913 | `toggleNotifPanel()` | bell panel; manager «من/همه» toggle (`_notifViewAll`) |
| 5043 | `openDailyMonitor()` | manager daily activity report modal |
| 5376 | `_TK_STATUSES` | default kanban columns (todo/doing/waiting/done) |
| 5383 | `_getTkStatuses()` | per-user columns from `DB.settings.taskColumns[currentUser]`, else defaults — use this, never `_TK_STATUSES` directly, in rendering |
| 5390 | `openTkColumnsModal()` | column manager UI (uses `window._tkColsPending` because modal onclicks can't close over locals) |
| 5470 | `renderTasksPanel()` | kanban/list board |
| 5572 | `openTaskModal(tid, prefill)` | task detail/create; `prefill={title,owner,dueDate,priority,centerKey}` |
| 5679 | `tkAddSub(tid,parentSid)` | inline subtask add row (Enter/Escape), `tkSubmitNewSub` |
| 5982 | `convertFollowupToTask(rtype,rid)` | followup → prefilled task |
| 5996 | `_wpGetOwner(we)` | canonical owner resolution |
| 6051 | `renderCalendar()` | Jalali calendar |
| 7405 | `openSettings()` | settings modal (members, tags, onboarding reset…) |
| 7622 | `renderManagerPanel()` | manager overview (cards, expert table, pipeline matrix, today summary) |
| 7848 | `openManagerDrilldown(memberId)` | expert detail: all assigned centers, expandable rows w/ last note + changeLog |
| 7931 | `openOverdueList(memberId?)` | overdue followups list (all or one expert) |
| 8128 | `init()` | startup |
| 8304 | `_initOnboarding()` | 7-day tutorial widget |
| 8976 | `calcCenterRecommendations()` | P1/P2-only suggestion engine, sorted P1 first |

### Key Helper Functions

| Function | Purpose |
|---|---|
| `esc(s)` | HTML-escape for safe innerHTML insertion |
| `fNorm(s)` | Normalize Persian text for search |
| `showToast(msg, dur)` | Global toast notification |
| `openModal(id, title, body, footer, opts)` | Generic modal — `opts.lg` for large |
| `openJDP(input, cb)` | Jalali date-picker popup |
| `_getCenterName(type, id)` | Display name for a center |
| `getAllProvinces()` / `getProvType(pid)` / `getProvCenters(pid)` | province/center iteration |
| `_buildPCCache()` | populate `_PC_CACHE[provId]` — call before touching pc centers |
| `umGetColor(uid)` | user's badge color |

### External Dependencies (CDN only)

- **Vazirmatn font** — `cdn.jsdelivr.net/npm/vazirmatn@33.003.0`
- **SheetJS/xlsx** — `cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`

### AI Feature

The receivables AI tab calls `https://api.anthropic.com/v1/messages` directly from the browser using model `claude-sonnet-4-20250514`. API key provided by user at runtime.

## Feature Inventory (what exists today)

| Feature | Where | Status |
|---|---|---|
| Province → center pipeline w/ status, lead, potential, owner | provinces tab | ✅ |
| Week plan: drag-drop scheduling, expert filter (unified across grid + center list), bulk move, progress bar | weekplan tab | ✅ |
| Done modal: structured logging (نتیجه / یادداشت / اقدام بعدی) on completion | weekplan | ✅ |
| Followup → next-date auto suggestion, overdue marking | center modal, banner | ✅ |
| Convert followup to task («📌 وظیفه» button) | center modal | ✅ |
| Kanban tasks: drag-drop, list view, filters, priority/owner/due | tasks tab | ✅ |
| Per-user custom kanban columns | tasks ⚙️ ستون‌ها | ✅ |
| 3-level subtasks, inline add/edit (no prompt()) | task modal | ✅ |
| In-app notifications + manager all-view toggle | bell icon | ✅ |
| Auto-reminders at startup (no-date / overdue centers) | init | ✅ |
| Manager overview: summary cards, expert table, pipeline matrix, today summary | manager tab | ✅ |
| Manager drill-down: expert → centers → notes/changeLog | click expert row | ✅ |
| Overdue list modal (per-expert or global) | click معوق numbers | ✅ |
| Recommendations: P1/P2 centers only, P1 first | provinces dashboard | ✅ |
| Center timeline / audit | center modal | ✅ |
| Onboarding: all 7 steps shown daily for 7 days, dismissible | startup widget | ✅ |
| Multi-contact per center (name, role, phones) | center modal | ✅ |
| Pricing module + per-item price edit + margin gated by password 62604193 | pricing tab | ✅ |
| Receivables (مطالبات) incl. AI analysis tab | mtr tab | ✅ semi-independent |
| Excel import/export of centers | provinces | ✅ |
| Global search (Ctrl+K style) | header | ✅ |
| Biopsy center discovery: Python scraper (nobat.ir, doctorto.ir) + AI web_search scan | KPI tab → کشف مراکز | ✅ |
| biopsyScore badge on center rows (🔬 score) from online enrichment | center list rows | ✅ |
| Claude API key config (env var or DB.settings.anthropicKey) | ⚙ Settings modal | ✅ |
| ☀️ امروز من: today's scheduled week entries at top of expert dashboard | provinces dashboard | ✅ |
| 📞 Quick post-call log: minimal modal (result+note+next-date) from list row or today section | center list, dashboard | ✅ |
| 🎯 Pre-call brief: last notes, changes, competitor, address before calling | center list row (🎯), modal footer | ✅ |
| 🗺 Navigation: map button next to address textarea → Google Maps | center modal | ✅ |
| 🤖 Competitor tracking: text field in center modal + orange badge in list row | center modal, list | ✅ |
| Commission level selector (cmCommission_) wired to pricing.commission_level + member commissionPct display | center modal | ✅ (live, not a placeholder) |
| 9 UX confusion fixes (banner role tag, kanban empty states, etc.) | various | ✅ |
| UI Polish v2: custom scrollbar, tab underline animation, card hover lift, pill buttons, input focus ring, modal entrance, notification pulse | css/app.css | ✅ |
| Comprehensive bug-fix pass: 15+ bugs fixed across backend routes + frontend modules | all files | ✅ |
| Tehran duplicate center merge: 219 mz_t_ pairs merged into c_ entries | scripts/merge_tehran_confirmed.py | ✅ |
| Automated DB backup: appdata every 10min + full daily, 30-day retention | scripts/backup_db.sh + crontab | ✅ |
| weekEntries guard: server merges instead of overwriting when incoming has fewer entries | server/routes/data.js | ✅ |
| DB history retention: extended from 30 snapshots to 30 days | server/routes/data.js | ✅ |
| WMS warehouse module: served at /wms, backed by PostgreSQL (9 tables), REST API at /api/wms | public/wms.html + server/routes/wms.js | ✅ |
| WMS REST endpoints: /api/wms/inventory (aggregate), /api/wms/lots/scan/:code (QR), /api/wms/transactions (paginated) | server/routes/wms.js | ✅ |
| WMS auto-migration: blob data migrated to SQL tables on first startup | server/db.js _migrateWMSFromBlob() | ✅ |
| Proforma invoice module: draft→sent→approved/rejected→reopen workflow, auto-number PF-YYYY-NNNN | proforma tab + /api/proforma | ✅ |
| Proforma SQL: zod validation, rowToObj mapper, manager-only approve/reject | server/routes/proforma.js | ✅ |
| Proforma auto-migration: blob migrated to SQL on first startup | server/db.js _migrateProformasFromBlob() | ✅ |
| Telegram bot: long-polling, CRM auth, proforma approve/reject inline keyboard, inventory check, QR scan | server/bot/telegram.js | ✅ |
| Security middleware: helmet (CSP off) + compression (graceful fallback) | server/index.js | ✅ |
| Vite + TypeScript + Vue 3 scaffold for incremental frontend migration | src/ + vite.config.ts + tsconfig.json | ✅ (placeholder) |
| دبیرخونه (letters/correspondence): standalone app at /letters, isolated from app.bundle.js | public/letters.html + server/routes/letters.js | ✅ |
| Letters: atomic indicator numbering (الف/ص-001-40312 format), referrals/کارتابل, templates, Quill WYSIWYG body editor, print template, canvas signature (signature_pad), letterhead background | public/letters.html | ✅ |
| Letters print template (official-letter grade): A4 `@page` rule, registration box (شماره/تاریخ/پیوست), confidential watermark stamp (`classification`), urgent/high priority stamp, Quill rich-text CSS preserved on print (align/indent/lists/links), configurable org info (name/address/phone/email/website via new ⚙ "اطلاعات سازمان" modal → `localStorage.letter_org_info`), preparer signature now resolves the letter's actual `createdBy` (not the current viewer), printed footer with org contact + registration disclaimer, on-screen print/close toolbar | public/letters.html (`printLetter`, `openOrgModal`/`_orgSave`/`_getOrgInfo`) | ✅ |
| Letters/WMS-proforma counterparty: typeahead search over CRM centers (GET /api/data/centers/master, flattened Tehran + province lists) instead of a plain `<select>` | public/letters.html, public/wms.html | ✅ |
| Admin visual workflow designer (SVG-based, manager-only): WMS Proforma / Letters / Tasks / CRM Centers sections | /admin + server/routes/admin.js | ✅ |
| WMS proforma versioning: editing a sent/approved proforma creates a new linked version (`POST /:id/revise`) instead of mutating the original; old version preserved, `GET /:id/versions` lists full chain | server/routes/wms-proforma.js + public/wms.html | ✅ |
| WMS proforma commission snapshot: on manager approval, center owner + commission % + commission amount are frozen into immutable columns (not recalculated if the center's owner later changes); cleared only on reopen | server/routes/wms-proforma.js | ✅ |
| WMS proforma receivables (مطالبات): derived from approved/voucher_issued proformas + payments table; full or partial payment recording | server/routes/wms-proforma.js (`GET /receivables`, `POST/GET /:id/payments`) + wms.html «مطالبات» page | ✅ |
| WMS proforma reports: per-user (date range, optional all-versions) and per-product/category sales | server/routes/wms-proforma.js (`GET /report/by-user`, `GET /report/by-product`) + wms.html «گزارش پیشفاکتور» page | ✅ |
| WMS proforma low-stock alarm: items flagged when requested qty exceeds current lot stock, shown on list row + detail view | server/routes/wms-proforma.js (`enrichStock`) + wms.html | ✅ |
| Center-profile proforma tab: read-only list of a center's proformas (number, date, total, status, version) loaded async via IIFE, link out to /wms | public/js/app.bundle.js `openCenterModal` (`cmWpf_` placeholder) | ✅ |
| WMS proforma print template (official Iranian پیش‌فاکتور grade): A4 layout, registration number/date box, seller + buyer party boxes, itemized table with lot numbers, totals breakdown (subtotal→تخفیف→مبلغ مشمول مالیات→مالیات بر ارزش افزوده→جمع کل), amount spelled out in Persian words (`numToPersianWords`), explicit legal disclaimer distinguishing پیش‌فاکتور from فاکتور رسمی, two-party signature boxes, configurable seller org info (`🏢 اطلاعات فروشنده` card on system-settings page → `localStorage.wms_org_info` via `_getWpfOrg`/`_wpfOrgSave`), on-screen print/close toolbar (no forced auto-print/auto-close); also fixed a pre-existing `esc()` undefined ReferenceError bug (only `esc2()` existed) | public/wms.html (`wpfPrint`, `renderSystem`) | ✅ |

## Planned Integration: Accounting Software → Receivables (مطالبات)

The product owner (hamidreza.soltanian@gmail.com) wants to connect the accounting system's database directly to the CRM so receivables (مطالبات) update in real-time without manual Excel uploads.

**Planned approach:**
- A server-side route (`/api/mtr/sync`) that pulls from the accounting DB (e.g., via ODBC/REST/PostgreSQL foreign data wrapper depending on the accounting software).
- The MTR panel would poll this endpoint periodically (e.g., SSE push or 5-min refresh) instead of requiring file upload.
- Matching algorithm (`matchCentersToData`) stays unchanged — it will still link accounting records to CRM centers.
- META (notes, followup dates, forecasts) lives in Click CRM's DB and is merged on top of live accounting data.
- Accounting software candidates: **میزیتو**, **رافع**, **هوفار**, **سپیدار**, **دینا** — integration method depends on which is in use.
- Until the integration is live, the existing Excel/TSV upload path remains the fallback.

**What needs to be done when the accounting software is identified:**
1. Add a `server/routes/mtr-sync.js` route that connects to accounting DB and returns normalized invoice rows.
2. Add `DB.settings.mtrSyncEnabled` toggle in Settings modal.
3. Add auto-refresh timer in `mtr.js` when sync is enabled.

---

## Roadmap / Future Plan

Priorities expressed by the product owner (hamidreza.soltanian@gmail.com), roughly ordered:

0. **Salesperson workflow polish** — `competitor` field is now tracked; commission level is wired to pricing config + member `commissionPct`, and WMS proforma approval now snapshots owner+commission immutably (`owner_at_approval`/`commission_pct_snapshot`/`commission_amount_snapshot`). Pre-call brief and quick-log are live; consider adding "call timer" or "call history" count to the brief. Remaining gap: a proper `commission_rules` table for tiered/per-product commission instead of the flat per-level percentage.
1. **Manager drill-down depth** — keep extending کلی→جزئی: from expert detail down to full written reports per center (currently shows last note + 5 changeLog entries; owner wants full report reading). Consider a dedicated per-expert report page aggregating done-modal structured logs (نتیجه/یادداشت/اقدام بعدی) by date range.
2. **Dashboard & overdue follow-up tracking** — keep making overdue work more actionable; possible next steps: overdue aging buckets, one-click reschedule from overdue list, weekly digest notification to manager.
3. **Task system maturity** — column reordering (drag), per-column WIP hints, task comments/activity, recurring tasks.
4. **Week plan** — owner repeatedly emphasized: ALL filtering must be consistent by expert everywhere; any new week-plan widget must respect `#wpOwnerFilter` + `_wpFclFilters` and the canonical owner-resolution chain.
5. **Data layer evolution (tech debt)** — single-blob `DB` JSON will not scale; eventual move to per-collection endpoints (tasks, notifications, changeLog) and optimistic merge instead of last-write-wins. SSE channel already exists (`/api/events`) — use it for live refresh.
6. **app.js modularization (tech debt)** — 12k+ lines in one file; if a build step is ever accepted, split by tab/module. Until then keep the function map above accurate.
7. **UX polish** — owner cares about "روان بودن" (flow); the app was renamed Flow for this reason. Prefer inline editing over prompt()/alert(), keep the indigo design system (`--brand:#6366f1`) consistent.

### Process Management (PM2)

پروداکشن با PM2 مدیریت می‌شود و بعد از ری‌استارت سرور خودکار بالا می‌آید.

```bash
# آپدیت و ری‌استارت (بعد از هر git pull)
cd /home/hamidreza/Sales-Portal && git pull origin claude/hopeful-bardeen-iz7jf9 && pm2 restart sales-portal

# وضعیت
pm2 status

# لاگ لایو
pm2 logs sales-portal

# ری‌استارت دستی
pm2 restart sales-portal

# اگر PM2 به هر دلیلی نبود، راه‌اندازی مجدد:
pkill -f "node server/index.js"; sleep 1
pm2 start server/index.js --name "sales-portal" && pm2 save
```

### Dev vs Prod environment

- **Prod**: `/home/hamidreza/Sales-Portal` — port 3000, managed by PM2 (autostart on reboot)
- **Dev**: `/home/hamidreza/Sales-Portal-dev` — port 4000, manual start
- **CRITICAL**: Both use the same PostgreSQL DB (`atena_crm`). Running dev with backend changes that write to DB can corrupt prod data.
- **Safe for dev**: frontend-only changes (HTML/CSS/JS) — the dev server just serves files, DB writes go to same place but are protected by weekEntries guard.
- **Unsafe for dev**: testing backend route changes (data.js, auth.js, etc.) — use a separate DB for that (see below).

#### Setting up a truly isolated dev DB:
```bash
# Create dev DB as a copy of prod (run once)
createdb -U postgres atena_crm_dev
pg_dump -U postgres atena_crm | psql -U postgres atena_crm_dev

# Set PG_DATABASE=atena_crm_dev in ~/Sales-Portal-dev/.env
# Then dev server writes to atena_crm_dev, prod stays clean
```

### Backup system

- **app_data every 10 min**: `scripts/backup_db.sh appdata` → `~/db_backups/appdata_*.sql.gz` (~456KB each, 30 days)
- **Full pg_dump daily at 3 AM**: `scripts/backup_db.sh full` → `~/db_backups/full_*.sql.gz` (~35MB each, 30 days)
- **Restore app_data**: `gunzip -c ~/db_backups/appdata_TIMESTAMP.sql.gz | psql -U postgres atena_crm`
- **Restore full**: `gunzip -c ~/db_backups/full_TIMESTAMP.sql.gz | psql -U postgres atena_crm`
- In-DB history: `app_data_history` table keeps 30 days of snapshots (previously was only 30 records)
- Use `scripts/restore_weekentries.py` to find and restore from DB snapshots

### weekEntries guard (data.js — PUT /api/data/db)

If an incoming save has FEWER weekEntries than what's currently in the DB, the server merges them (server entries + incoming entries) instead of overwriting. This prevents a stale browser session from wiping the team's week plan.
Logged as: `[data/db PUT] weekEntries guard: merged server(N) + incoming(M) → K`

### Tehran duplicate center merge

- 219 confirmed duplicate pairs (mz_t_ → c_) merged via `scripts/merge_tehran_confirmed.py`
- Analysis script: `scripts/analyze_export_dupes.py` (works on exported TXT, no DB needed)
- After merge, `scripts/check_weekentries.py` migrates orphaned weekEntries from mz_t_ keys to c_ keys
- Diagnostic tools: `scripts/inspect_weekentries.py`, `scripts/inspect_new_centers.py`

### Bug-fix history (session June 2026)

**Backend (server/routes/):**
- `data.js`: History ops inside transaction used `.catch()` that silently put PG into aborted-transaction state → fixed with `SAVEPOINT history_ops`
- `data.js`: `pool.connect()` not in try block → crash if pool throws → fixed with `let client` before try, `if(client)` in finally
- `ai.js`: Unbounded `max_tokens`/`model` from client body → API abuse → fixed with model allowlist + `Math.min(8192, ...)`
- `pricing.js`: XSS in `/quotes/:id/print` — DB values interpolated raw into HTML → added `he()` HTML-escape helper
- `pricing.js`: `parseInt(limit)` NaN → 500 error → fixed with `Math.min(Math.max(parseInt||50, 1), 200)`
- `contacts.js`: Phone search used `$1 = ANY(phones)` with `%q%` LIKE pattern (exact match = always empty) → fixed with `EXISTS (SELECT 1 FROM unnest(phones) p WHERE p ILIKE $1)`
- `distribution.js`: `parseInt(id)` without NaN guard in approve/reject → 500 instead of 400 → added guard

**Frontend (public/js/ modules):**
- `manager.js`: `i` from `forEach(function(c,i){...})` used in onclick string as `+i+` literal text → ReferenceError at click time → fixed by breaking string to embed literal value at build time
- `manager.js`: Note date/author fields used `n.at`/`n.by` (new format only) → fixed to `n.date||fmtDate(n.at)` and `n.by||n.user`
- `dashboard.js`: Same note field issue in pre-call brief → same fix
- `provinces.js`: `Object.keys(DB.edits).forEach()` without null guard → crash on fresh DB → fixed with `DB.edits||{}`
- `calendar.js`: `Math.max.apply(null, ids)` with NaN ids → `_nextEvId = NaN` → duplicate events → fixed with isNaN filter
- `calendar.js`: `evId?find():null` → event id=0 treated as falsy → edit becomes create → fixed with `evId!==null&&evId!==undefined`
- `weekplan.js`: `renderList` is a local `var`, used in `oninput="renderList()"` (global scope) → ReferenceError → fixed with `window._wpPickRenderList = renderList`
- `weekplan.js`: `recKey.split('_')[1]` truncates IDs with underscores (e.g. `pc_north_khorasan||1`) → fixed with `split('_').slice(1).join('_')`
- `backup.js`: `doDBImport` promise chain had no `.catch()` → button stuck disabled on error → added `.catch()`
- `center-modal.js`: `popup.style.top=...` with no null check after `getElementById` → added early return

### Product principles (learned from owner feedback)

- Center value must NOT be reduced to a single number — potential (P1–P4) plus status is the model; recommendations only from P1/P2.
- Experts should be auto-reminded (startup notifications) — don't rely on them checking.
- Managers want both: a fast at-a-glance overview AND the ability to drill down to raw written reports.
- Everything filterable by expert; experts only see their own centers (managers see all).
- All UI text in Persian; all dates Jalali; layout RTL.

---

## Sales Playbook Gap Analysis (فایل: crm_gap_analysis.md)

Based on the Atena Sales Playbook v1.0. These are features the playbook requires that the CRM must implement.

### Implementation Status

| # | Feature | Priority | Status |
|---|---|---|---|
| 1 | Customer Status خودکار (New/Active/Dormant/Lost) بر اساس آخرین خرید | 🔴 حیاتی | ✅ DONE |
| 2 | Dormant detection: مشتری بدون خرید > 90 روز شناسایی خودکار شود | 🔴 حیاتی | ✅ DONE |
| 3 | Closed Lost Reason: popup اجباری هنگام غیرفعال/بستن Opportunity | 🔴 حیاتی | ✅ DONE |
| 4 | Opportunity fields: احتمال موفقیت (کم/متوسط/زیاد) + درجه A/B/C | 🔴 حیاتی | ✅ DONE |
| 5 | Opportunity value: ارزش فرصت به عنوان فیلد مرکز (نه فقط done entry) | 🔴 حیاتی | ✅ DONE |
| 6 | Activity type dropdown کامل: ارسال قیمت / نمونه / کمیته / جلسه / ... | 🟠 مهم | ✅ DONE |
| 7 | No-Next-Step flag: نشانگر نارنجی روی مراکز فعال بدون followupDate | 🟠 مهم | ✅ DONE |
| 8 | فیلدهای رقیب تکمیلی: مزیت / دلیل خرید از رقیب | 🟠 مهم | ✅ DONE |
| 9 | گزارش هفتگی: New Opportunity / مشتری جدید / مشتری خوابیده این هفته | 🟠 مهم | ✅ DONE |
| 10 | فاصله پیگیری per-Stage: Lead 7d / Opportunity داغ 2-3d / Dormant ماهانه | 🟡 مطلوب | ✅ DONE |
| 11 | Pipeline value: ارزش کل Pipeline به تفکیک Stage در dashboard مدیر | 🟡 مطلوب | ✅ DONE |
| 12 | KOL/پزشک Entity جداگانه با رابطه many-to-many به مراکز | 🟡 مطلوب | 🔲 TODO |
| 13 | Stage validation: فیلدهای اجباری قبل از تغییر Stage | 🟡 مطلوب | ✅ DONE |
| 14 | فیلدهای Prospect تکمیلی: میزان مصرف / نحوه خرید / شرایط پرداخت | 🟡 مطلوب | ✅ DONE |
| 15 | گزارش per-رقیب: چه مراکزی به کدام رقیب داده‌ایم و چرا | 🟡 مطلوب | ✅ DONE |

### Data Model Extensions Needed

```
DB.edits[key] extensions:
  customerStatus: 'new' | 'active' | 'active_new' | 'dormant' | 'lost'  ← auto-computed
  lastPurchaseDate: 'YYYY/MM/DD'    ← Jalali, updated on sale log
  firstPurchaseDate: 'YYYY/MM/DD'   ← Jalali, set on first sale
  closeReason: string               ← mandatory on غیرفعال/بسته
  oppProbability: 'low'|'medium'|'high'   ← shown when lead=فرصت
  oppGrade: 'A'|'B'|'C'            ← hot/warm/cold, shown when lead=فرصت
  oppValue: number                  ← M ریال, shown when lead=فرصت
  competitorAdvantage: string
  competitorWeakness: string
  buyReasonFromCompetitor: string
  consumptionVolume: string         ← Prospect field
  purchaseMethod: string            ← Prospect field
  paymentTerms: string              ← Prospect field
```

### Action Type Extensions
Current: `'call' | 'visit'`
Target:  `'call' | 'visit' | 'price_send' | 'sample_send' | 'committee' | 'meeting' | 'followup'`

Persian labels:
```javascript
var ACTION_TYPE_LABELS = {
  call: '📞 تماس', visit: '🤝 ملاقات', price_send: '📄 ارسال قیمت',
  sample_send: '🧪 ارسال نمونه', committee: '🏛 پیگیری کمیته',
  meeting: '👥 جلسه', followup: '🔄 پیگیری'
};
```

## Workflow Checklist for every change

1. Read exact lines with `repr()` before replacing (NBSP hazard).
2. Edit `public/js/app.js` / `public/css/app.css` / `public/index.html` via Python scripts.
3. `node --check public/js/app.js` — must pass.
4. Commit with a descriptive message; push to the designated branch.
5. Update this file's Feature Inventory / Function Map / Roadmap if they changed.

---

## راهنمای افزودن ماژول جدید (Module Integration Blueprint)

> این بخش برای هوش مصنوعی نوشته شده است. هر بار که می‌خواهی ماژول جدیدی به این پروژه اضافه کنی، این راهنما را از اول تا آخر بخوان.

### اصل پایه: ایزولاسیون کامل

**هیچ‌وقت app.bundle.js را لمس نکن.** این فایل ستون فقرات اپ اصلی است و NBSP دارد.
هر ماژول جدید = یک صفحه HTML مستقل (`public/NEW.html`) + یک route فایل (`server/routes/new.js`) + جداول DB جدید.
تنها اتصال به اپ اصلی: **یک لینک `<a>` در sidebar سمت راست `index.html`** + سه خط در `server/index.js`.

### گام ۱ — ساختار فایل‌های جدید (۶ فایل)

```
public/
  YOUR_MODULE.html           ← صفحه مستقل (کپی الگو از letters.html)
server/
  routes/
    your-module.js           ← Express router (کپی الگو از letters.js)
```

در `server/db.js` داخل `initSchema()` جداول جدید اضافه می‌شوند (همان فایل، بدون فایل جدید).
در `server/index.js` دو خط mount اضافه می‌شود (همان فایل، بدون فایل جدید).
در `public/index.html` یک لینک `<a>` در sidebar اضافه می‌شود (همان فایل، فقط یک خط).

---

### گام ۲ — جداول PostgreSQL (در `server/db.js` → `initSchema()`)

```sql
-- همیشه IF NOT EXISTS؛ ایمن روی DB زنده
CREATE TABLE IF NOT EXISTS your_module_items (
  id          VARCHAR(50)  PRIMARY KEY,      -- تولید با _genId()
  ...فیلدها...
  created_by  VARCHAR(100),                  -- username از session
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW(),
  is_deleted  BOOLEAN      DEFAULT false     -- حذف نرم، نه DELETE واقعی
);
CREATE INDEX IF NOT EXISTS idx_ymi_created_at ON your_module_items(created_at DESC);
```

**قوانین DB:**
- هیچ‌وقت `ALTER TABLE ... DROP COLUMN` یا `DROP TABLE` نزن — فقط `ADD COLUMN IF NOT EXISTS`.
- `id` را server-side با `_genId()` تولید کن، نه auto-increment.
- هر جدول حداقل: `id`, `created_by`, `created_at`, `is_deleted`.
- برای workflow statuses: `CHECK(status IN ('draft','sent','approved'))`.
- برای counters atomic (مثل شماره‌های اندیکاتور): جدول جداگانه با `ON CONFLICT DO UPDATE`.

---

### گام ۳ — route فایل (`server/routes/your-module.js`)

```javascript
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAuth, requireManager } = require('../auth');

// helper: UUID-like id
function _genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// لیست (GET /)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM your_module_items WHERE is_deleted=false ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ایجاد (POST /)
router.post('/', requireAuth, async (req, res) => {
  const { field1, field2 } = req.body;
  if (!field1) return res.status(400).json({ error: 'field1 required' });
  try {
    const id = _genId();
    const { rows } = await pool.query(
      `INSERT INTO your_module_items (id, field1, field2, created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id, field1, field2 || null, req.session.username]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ویرایش (PUT /:id)
router.put('/:id', requireAuth, async (req, res) => {
  // مطمئن شو status=draft است قبل از ویرایش (اگر workflow دارد)
  try {
    const { rows } = await pool.query(
      `UPDATE your_module_items SET field1=$1, updated_at=NOW() WHERE id=$2 AND is_deleted=false RETURNING *`,
      [req.body.field1, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// حذف نرم (DELETE /:id)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE your_module_items SET is_deleted=true WHERE id=$1`, [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// اگر workflow action نیاز است (POST /:id/action)
router.post('/:id/action', requireAuth, async (req, res) => {
  const { action } = req.body;
  const VALID = { draft: ['send'], sent: ['approve', 'reject'], approved: ['cancel'] };
  // بررسی کن وضعیت فعلی اجازه این action را می‌دهد
  // سپس UPDATE وضعیت
});

// برای عملیات حساس مثل تأیید مدیر: requireManager
router.post('/:id/approve', requireManager, async (req, res) => { /* ... */ });

module.exports = router;
```

**قوانین route:**
- هر endpoint با `try/catch` و `res.status(500).json({error:e.message})` پوشش داده شود.
- هیچ‌وقت raw user input را در SQL query string interpolate نکن — همیشه `$1,$2,...` parametrized.
- حذف = `is_deleted=true`، نه `DELETE FROM`.
- برای `requireAuth` و `requireManager` از `../auth` import کن.
- اگر چند عملیات باید atomic باشند: `const client = await pool.connect()` + `BEGIN/COMMIT/ROLLBACK`.

---

### گام ۴ — mount در `server/index.js`

فقط سه خط در جای مناسب (بعد از routes موجود):
```javascript
// ---- NEW MODULE ----
app.get('/your-module', (req, res) => res.sendFile(path.join(__dirname, '../public/YOUR_MODULE.html')));
app.use('/api/your-module', require('./routes/your-module'));
```

این خط‌ها را **قبل از** خط `app.get('*', ...)` یا هر catch-all route بگذار.

---

### گام ۵ — صفحه مستقل HTML (`public/YOUR_MODULE.html`)

**الگو**: کپی ساختار `public/letters.html` (نه wms.html — letters.html تمیزتر و جدیدتر است).

#### ۵.۱ ساختار کلی HTML
```html
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>نام ماژول · آتنا</title>
  <link href="https://cdn.jsdelivr.net/npm/vazirmatn@33.003.0/Vazirmatn-font-face.css" rel="stylesheet">
  <style>
    /* CSS Variables — همیشه یکسان در همه standalone pages */
    :root {
      --brand:#6366f1; --brand-d:#4f46e5; --brand-light:#e0e7ff;
      --surface:#fff; --surface2:#f8fafc; --border:#e2e8f0;
      --text:#0f172a; --text2:#64748b; --radius:10px;
    }
    /* Reset + RTL base */
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:Vazirmatn,sans-serif; direction:rtl; background:var(--surface2); color:var(--text); }
    /* ... بقیه styles */
  </style>
</head>
<body>
  <!-- Layout: sidebar + main -->
  <div id="app" style="display:flex;height:100vh;overflow:hidden">
    <aside id="sidebar">...</aside>
    <main id="main" style="flex:1;overflow-y:auto;padding:24px">
      <div id="content"></div>
    </main>
  </div>
  <div id="toast-container" style="position:fixed;bottom:24px;right:24px;z-index:9999"></div>
  <script>
    /* --- helpers --- */
    /* --- state --- */
    /* --- init --- */
    /* --- render functions --- */
  </script>
</body>
</html>
```

#### ۵.۲ Auth در standalone page (الزامی)

```javascript
// خواندن token از cookie — همیشه این الگو
function _getToken() {
  return document.cookie.split(';').map(c => c.trim())
    .find(c => c.startsWith('atena_token='))?.split('=').slice(1).join('=') || '';
}

// API call helper — همیشه این الگو
async function api(method, path, body) {
  const opts = {
    method, credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch('/api' + path, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
  }
  return r.json();
}

// بررسی login در init
async function init() {
  try {
    const me = await api('GET', '/auth/me');
    // me = { username, name, role }
    if (!me || !me.username) { window.location.href = '/'; return; }
    S.user = me;
    // ...ادامه init
  } catch(e) {
    window.location.href = '/';
  }
}
document.addEventListener('DOMContentLoaded', init);
```

**نکته**: `credentials:'include'` الزامی است — session cookie را می‌فرستد.

#### ۵.۳ Helper‌های استاندارد (کپی مستقیم)

```javascript
function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, type) {
  const t = document.createElement('div');
  t.style.cssText = `background:${type==='e'?'#ef4444':type==='s'?'#22c55e':'#1a2744'};color:#fff;padding:10px 18px;border-radius:8px;margin-top:8px;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.2)`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function fmtDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleDateString('fa-IR');
}
```

#### ۵.۴ اتصال به مراکز CRM (typeahead)

هر وقت کاربر باید یک «مرکز» یا «طرف حساب» از CRM اصلی انتخاب کند:

```javascript
let _crmCenters = []; // [{key, name}]

function _flatCenters(d) {
  const list = [];
  (d.CENTERS || []).forEach(c => list.push({ key: c.id, name: c.name }));
  Object.entries(d.PC_RAW || {}).forEach(([provId, rows]) => {
    (rows || []).forEach((row, i) => list.push({ key: provId+'||'+i, name: row[1]||row[0]||'' }));
  });
  return list;
}

// در init() بعد از auth:
try {
  const cr = await api('GET', '/data/centers/master');
  _crmCenters = _flatCenters(cr);
} catch(e) { /* ادامه بده بدون مراکز */ }

// HTML typeahead:
// <input id="my-txt" oninput="_searchCenter(this.value,'my-drop','my-key','my-txt')" />
// <input type="hidden" id="my-key" />
// <div id="my-drop" class="csd-drop"></div>

function _searchCenter(q, dropId, keyId, txtId) {
  const drop = document.getElementById(dropId);
  if (!drop) return;
  if (!q.trim()) { drop.innerHTML = ''; return; }
  const results = _crmCenters.filter(c => c.name.includes(q.trim())).slice(0, 8);
  drop.innerHTML = results.map(c =>
    `<div class="csd-item" onclick="_pickCenter('${esc(c.key)}','${esc(c.name)}','${dropId}','${keyId}','${txtId}')">${esc(c.name)}</div>`
  ).join('');
}

function _pickCenter(key, name, dropId, keyId, txtId) {
  document.getElementById(txtId).value = name;
  document.getElementById(keyId).value = key;
  document.getElementById(dropId).innerHTML = '';
}
```

CSS برای dropdown (اضافه به `<style>`):
```css
.csd-drop { position:absolute; top:100%; right:0; left:0; background:var(--surface); border:1px solid var(--border); border-radius:8px; z-index:200; max-height:220px; overflow-y:auto; box-shadow:0 4px 16px rgba(0,0,0,.15); }
.csd-item { padding:8px 12px; cursor:pointer; font-size:13px; }
.csd-item:hover { background:var(--surface2); }
```

#### ۵.۵ Modal pattern

```javascript
let _moStack = []; // برای اینکه چند modal داشته باشیم

function openMo(id, title, body, footer) {
  const existing = document.getElementById(id);
  if (existing) existing.remove();
  const mo = document.createElement('div');
  mo.id = id;
  mo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px';
  mo.innerHTML = `
    <div style="background:var(--surface);border-radius:var(--radius);width:100%;max-width:600px;max-height:90vh;overflow-y:auto">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <strong>${esc(title)}</strong>
        <button onclick="closeMo('${id}')" style="border:none;background:none;font-size:18px;cursor:pointer">×</button>
      </div>
      <div style="padding:20px">${body}</div>
      ${footer ? `<div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px">${footer}</div>` : ''}
    </div>`;
  document.body.appendChild(mo);
  _moStack.push(id);
}

function closeMo(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
  _moStack = _moStack.filter(m => m !== id);
}
```

#### ۵.۶ Print template pattern

```javascript
function printItem(item) {
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html lang="fa" dir="rtl"><head>
    <meta charset="UTF-8"><title>چاپ</title>
    <link href="https://cdn.jsdelivr.net/npm/vazirmatn@33.003.0/Vazirmatn-font-face.css" rel="stylesheet">
    <style>
      @page { size:A4; margin:0; }
      * { box-sizing:border-box; }
      body { font-family:Vazirmatn,sans-serif; direction:rtl; margin:0; }
      .toolbar { position:sticky;top:0;z-index:50;background:#1a2744;color:#fff;padding:10px 16px;display:flex;justify-content:center;gap:10px; }
      .toolbar button { font-family:Vazirmatn,sans-serif;border:none;border-radius:6px;padding:8px 16px;font-size:13px;cursor:pointer; }
      .sheet { width:21cm;min-height:29.7cm;margin:16px auto;padding:1.6cm;background:#fff;box-shadow:0 2px 12px rgba(0,0,0,.15); }
      @media print { .toolbar { display:none; } .sheet { margin:0;width:100%;box-shadow:none; } }
    </style>
  </head><body>
    <div class="toolbar">
      <button style="background:#0284c7;color:#fff" onclick="window.print()">🖨 چاپ</button>
      <button style="background:#475569;color:#fff" onclick="window.close()">✕ بستن</button>
    </div>
    <div class="sheet">
      <!-- محتوا -->
    </div>
  </body></html>`);
  w.document.close();
  // هیچ‌وقت window.print() یا setTimeout close نزن — کاربر خودش کلیک می‌کند
}
```

#### ۵.۷ تنظیمات localStorage

اگر ماژول نیاز به پیکربندی قابل ذخیره دارد (مثل اطلاعات فروشنده در WMS proforma):
```javascript
const LS_KEY = 'your_module_config';

function _getCfg() {
  const def = { name: '', setting1: '', setting2: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return { ...def, ...saved };
  } catch(e) { return def; }
}

function _saveCfg() {
  const cfg = {
    name: document.getElementById('cfg-name').value.trim(),
    setting1: document.getElementById('cfg-s1').value.trim()
  };
  localStorage.setItem(LS_KEY, JSON.stringify(cfg));
  showToast('تنظیمات ذخیره شد', 's');
}
```

---

### گام ۶ — لینک در sidebar اپ اصلی (`public/index.html`)

فقط یک خط `<a>` در sidebar (جستجو کن `href="/wms"` تا موقعیت مناسب پیدا شود):

```html
<a href="/your-module" class="tab-btn" title="نام ماژول" target="_blank">
  <span class="sb-icon">🔧</span><span class="sb-label">نام ماژول</span>
</a>
```

**نکته مهم**: `index.html` را با Python ویرایش نکن (آن NBSP ندارد و Edit tool امن است). اما `app.bundle.js` را هرگز لمس نکن.

---

### گام ۷ — راستی‌آزمایی قبل از commit

```bash
# ۱. بررسی NBSP (فقط برای app.bundle.js مهم است، اما برای همه چک کن)
python3 -c "
with open('public/YOUR_MODULE.html','r',encoding='utf-8') as f: c=f.read()
print('NBSP count:', c.count('\xa0'))
"

# ۲. بررسی syntax JavaScript
python3 -c "
import re
with open('public/YOUR_MODULE.html','r',encoding='utf-8') as f: c=f.read()
scripts = re.findall(r'<script[^>]*>(.*?)</script>', c, re.S)
with open('/tmp/check_module.js','w',encoding='utf-8') as f:
    [f.write(s+'\n;\n') for s in scripts]
" && node --check /tmp/check_module.js && echo "SYNTAX OK"

# ۳. بررسی route syntax
node --check server/routes/your-module.js && echo "ROUTE OK"
```

---

### جدول تصمیم‌گیری: backend نیاز به چی دارد؟

| سوال | پاسخ بله | پاسخ خیر |
|---|---|---|
| داده‌ها ساده و بدون workflow هستند؟ | CRUD ساده (GET/POST/PUT/DELETE) | ادامه به سوال بعدی |
| workflow چند مرحله‌ای نیاز است؟ | `POST /:id/action` + جدول statuses | — |
| نیاز به تأیید مدیر دارد؟ | `requireManager` روی endpoint مربوطه | `requireAuth` کافی است |
| عملیات atomic نیاز است (تغییر موجودی + ثبت تراکنش)؟ | PostgreSQL transaction (`BEGIN/COMMIT`) | query های مجزا |
| شماره‌گذاری serial و منحصربه‌فرد نیاز است؟ | جدول sequence جداگانه + `ON CONFLICT DO UPDATE` | UUID/timestamp id کافی است |
| فایل آپلود نیاز است؟ | `multer` middleware + مسیر آپلود | — |
| گزارش پیچیده نیاز است؟ | endpoint گزارش جداگانه (`GET /report/...`) | aggregate در list endpoint |

---

### اشتباهات رایج — از هیچ‌کدام نکن

| اشتباه | درست |
|---|---|
| `app.bundle.js` را با Edit tool ویرایش کن | همیشه Python `content.replace()` |
| `esc()` را فراموش کن در innerHTML | همه user data را از `esc()` رد کن |
| `DELETE FROM table WHERE id=...` بنویس | `UPDATE SET is_deleted=true` |
| String interpolation در SQL: `WHERE id='${id}'` | همیشه `$1`, `$2` parametrized |
| `window.print()` و `setTimeout(close,1200)` در print | toolbar با دکمه دستی |
| یک `<select>` بزرگ برای مراکز CRM بساز | typeahead با `_searchCenter` |
| مقدار نداشتن `credentials:'include'` در fetch | اضافه کن — session cookie لازم است |
| modal با `prompt()` یا `confirm()` | `openMo()` با HTML سفارشی |
| تنظیمات ماژول را در DB ذخیره کن (schema change) | `localStorage` برای تنظیمات سمت client |
| commit بدون `node --check` | همیشه syntax check قبل از commit |

---

### نمونه کامل: ماژول جدید «صورت‌حساب» در ۵ دقیقه

```
1. DB: در initSchema() جدول invoices + idx اضافه کن
2. Route: server/routes/invoices-new.js — CRUD + workflow
3. Serve: server/index.js — app.get('/invoices') + app.use('/api/invoices-new')
4. HTML: public/invoices.html — کپی letters.html، تغییر title + sidebar + render functions
5. Link: public/index.html — یک <a href="/invoices"> در sidebar
6. Check: NBSP=0، syntax OK، node --check route OK
7. Commit + push
```

**مدت واقعی**: اگر این راهنما را دنبال کنی و از letters.html کپی کنی، ۲-۳ ساعت کافی است برای یک ماژول ساده با CRUD.
