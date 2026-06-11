# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
It is the single source of truth for an AI to understand the entire app and its future plan — keep it updated after every significant change.

## Project Name

**Flow CRM** — Persian-language (RTL, Jalali calendar) CRM for a medical equipment sales team (~5 users).
No framework, no build step: vanilla JS frontend + Express/PostgreSQL backend.

## Running the App

```bash
# Development server (Node.js + PostgreSQL backend)
cd /home/user/Sales-Portal && node server/index.js
# then open http://localhost:3000

# Or serve static only (no backend persistence)
python3 -m http.server 8080
# then open http://localhost:8080/public/index.html

# Syntax check after any JS edit (mandatory):
node --check public/js/app.js
```

## File Structure

```
Sales-Portal/
  public/
    index.html          ← HTML shell only (~640 lines): markup, tab buttons, panel divs
    css/app.css         ← all styles (~1,150 lines), indigo design system
    js/app.js           ← ALL application logic (~13,450 lines)
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
      discovery.js      ← /api/discovery (biopsy center discovery: list, ai-scan, import-file)
  scripts/
    discover_centers.py ← CLI scraper (nobat.ir, doctorto.ir, --ai, --enrich modes)
  atena_crm_v3_mtr_3.html  ← legacy snapshot of the OLD single-file app (frozen; no longer synced line-by-line, kept for history)
  CLAUDE.md
```

> History note: the frontend used to be one giant HTML file. It was split into
> `index.html` + `css/app.css` + `js/app.js` (commit `cfc5741`). All new work goes
> into the split files. `atena_crm_v3_mtr_3.html` is a frozen legacy copy.

## ⚠️ Critical Edit Constraint

`public/js/app.js` (and the legacy HTML) contain **non-breaking spaces (`\xa0`)** mixed into indented lines, plus deeply nested quote-escaping inside HTML-string templates.
**NEVER use the Edit tool directly on these files** — exact-match will fail or corrupt content.

**Always use Python scripts:**
```python
with open(FILEPATH, 'r', encoding='utf-8') as f:
    content = f.read()
# use content.replace(old, new, 1) with exact strings verified via repr()
with open(FILEPATH, 'w', encoding='utf-8') as f:
    f.write(content)
```

To inspect an exact line before replacing (0-indexed):
```bash
python3 -c "
with open('public/js/app.js','r',encoding='utf-8') as f:
    lines=f.readlines()
print(repr(lines[LINE_IDX]))
"
```

**Quote-escaping rule for generated HTML:** most UI is built as JS strings with
`onclick="fn(\''+var+'\')"` patterns. When writing such strings from Python, the
JS source must contain `\\'` (backslash-quote) inside the double-quoted HTML
attribute. Always run `node --check public/js/app.js` after editing — past
sessions introduced 6+ syntax errors from getting this wrong.

## Architecture

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
The whole `DB` object is saved as one JSON blob — there is no per-record API; concurrency is last-write-wins with SSE refresh hints.

The main `DB` object contains:
```
edits, notes, tags, rTags, weekTags, weekEntries, events, checklist,
extra, settings, kpiTargets, callLog, visitLog, salesLog, missionLog,
provHistory, mtrFollower, mtrFollowerMap, changeLog, mtrTrend,
notifications, tasks
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
| Commission placeholder div (cmCommission_) next to competitor field | center modal | ✅ (placeholder) |
| 9 UX confusion fixes (banner role tag, kanban empty states, etc.) | various | ✅ |

## Roadmap / Future Plan

Priorities expressed by the product owner (hamidreza.soltanian@gmail.com), roughly ordered:

0. **Salesperson workflow polish** — `competitor` field is now tracked; commission view is a placeholder (`cmCommission_` div) — wire it to actual commission_rules table or pricing margins. Pre-call brief and quick-log are live; consider adding "call timer" or "call history" count to the brief.
1. **Manager drill-down depth** — keep extending کلی→جزئی: from expert detail down to full written reports per center (currently shows last note + 5 changeLog entries; owner wants full report reading). Consider a dedicated per-expert report page aggregating done-modal structured logs (نتیجه/یادداشت/اقدام بعدی) by date range.
2. **Dashboard & overdue follow-up tracking** — keep making overdue work more actionable; possible next steps: overdue aging buckets, one-click reschedule from overdue list, weekly digest notification to manager.
3. **Task system maturity** — column reordering (drag), per-column WIP hints, task comments/activity, recurring tasks.
4. **Week plan** — owner repeatedly emphasized: ALL filtering must be consistent by expert everywhere; any new week-plan widget must respect `#wpOwnerFilter` + `_wpFclFilters` and the canonical owner-resolution chain.
5. **Data layer evolution (tech debt)** — single-blob `DB` JSON will not scale; eventual move to per-collection endpoints (tasks, notifications, changeLog) and optimistic merge instead of last-write-wins. SSE channel already exists (`/api/events`) — use it for live refresh.
6. **app.js modularization (tech debt)** — 12k+ lines in one file; if a build step is ever accepted, split by tab/module. Until then keep the function map above accurate.
7. **UX polish** — owner cares about "روان بودن" (flow); the app was renamed Flow for this reason. Prefer inline editing over prompt()/alert(), keep the indigo design system (`--brand:#6366f1`) consistent.

### Product principles (learned from owner feedback)

- Center value must NOT be reduced to a single number — potential (P1–P4) plus status is the model; recommendations only from P1/P2.
- Experts should be auto-reminded (startup notifications) — don't rely on them checking.
- Managers want both: a fast at-a-glance overview AND the ability to drill down to raw written reports.
- Everything filterable by expert; experts only see their own centers (managers see all).
- All UI text in Persian; all dates Jalali; layout RTL.

## Workflow Checklist for every change

1. Read exact lines with `repr()` before replacing (NBSP hazard).
2. Edit `public/js/app.js` / `public/css/app.css` / `public/index.html` via Python scripts.
3. `node --check public/js/app.js` — must pass.
4. Commit with a descriptive message; push to the designated branch.
5. Update this file's Feature Inventory / Function Map / Roadmap if they changed.
