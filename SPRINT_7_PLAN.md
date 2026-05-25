# Family Guardian — Sprint 7 Plan: iOS Parity + Routines v2 + Safety v2

> **On approval, this plan will be saved to `h:\family-guardian\SPRINT_7_PLAN.md`** (matching the location of `SPRINT_5_PLAN.md` and `SPRINT_6_PLAN.md`).
>
> Paste the saved file into a fresh Claude Code session at `h:\family-guardian` and tell the agent: **"Pick up the Family Guardian work — read SPRINT_7_PLAN.md and continue with P1.1. Read HANDOFF.md first for repo conventions."**

---

## Context

**Why this sprint.** Sprints 1–6 stacked privacy, smart notifications, chat polish, driving safety, smart routines, and insights & visibility. The platform is feature-rich, but three concrete gaps are blocking the experience from feeling finished:

1. **iOS lags behind Android on Sprint 5 + Sprint 6 surfaces.** Android shipped `RoutinesScreen`, `DigestScreen`, and a dedicated `TripsScreen`; iOS only has the toggles and inline summaries inside `MoreTab`. iOS users can't view or manage their learned routines, can't open last week's digest detail, and have to dig into a member page to see trip history. This is the most-noticed daily friction.
2. **Routines only know "arrival" and "departure".** `SPRINT_5_PLAN.md` design decision #7 explicitly deferred the `dwell` kind ("Sarah is still at the coffee shop 90 min after her usual 30"). The schema CHECK constraint already lists `dwell` as a documented future kind. The mining and alert logic just isn't there yet.
3. **Safety is reactive, not proactive.** Sprint 4 ships crash detection; Sprint 5 ships routine deviation. There's no curfew/bedtime mode (the single most-requested feature in any family-safety category), no low-battery push (so a dead phone looks identical to a paused user), and no SOS escalation outside the immediate circle (a grandparent or family friend can't be looped in without joining the circle and getting full location access).

Sprint 7 closes all three gaps in one focused theme: **make the existing surfaces feel complete, then extend routines and safety with the most-requested missing pieces.** No new sensors; no new privacy model; one new lightweight relationship type (emergency contact) that is push-only and grants no location visibility.

**House-rules carryover** (locked-in by `NEXT_SPRINT_PROMPT.md`, `SPRINT_5_PLAN.md`, `SPRINT_6_PLAN.md`):
- One focused theme per sprint. Don't add features beyond scope. Don't over-engineer.
- Test on a live server (not just syntax-check) before claiming a phase done.
- Pause after each sub-feature for human verification before proceeding.
- Don't commit unless asked. Don't push, ever.
- ESM with `.js` extensions, synchronous `db.transaction(() => {})()`, Pino logs.
- Raw-replace before safe-replace in `routes/web.js` template render. Don't reorder.
- **Never wipe the docker volume or on-device app data without explicit in-the-moment permission.** Always spin up isolated test instances (separate container name, different port, different volume) for smoke testing. Past approval does not carry forward.

---

## Roadmap at a glance

| Sprint | Theme | Status |
|---|---|---|
| 1 | Privacy & Control | **Shipped** |
| 2 | Smart Notifications + Reactions | **Shipped** |
| 3 | Chat polish | **Shipped** |
| 4 | Driving safety (crash detection + score) | **Shipped** |
| 5 | Smart Routines & Deviation | **Shipped** |
| 6 | Insights & Visibility | **Shipped** |
| **7** | **iOS Parity + Routines v2 + Safety v2** | **This sprint** |

---

## Sprint 7 sub-features

Eight sub-features across three phases. Each has its own verification gate. **Each phase can be cut short and deferred to Sprint 8 if scope feels heavy** — the phases are independent.

### Phase 1 — iOS parity catch-up (no server changes)

| Sub | Title | Server | iOS | Android | PWA |
|---|---|---|---|---|---|
| P1.1 | iOS **RoutinesScreen** (list, toggle, delete, manual create) | None | Medium | — | — |
| P1.2 | iOS **Weekly Digest detail** screen + this-week card | None | Small | — | — |
| P1.3 | iOS dedicated **TripsScreen** | None | Small | — | — |

### Phase 2 — Smart Routines v2

| Sub | Title | Server | iOS | Android | PWA |
|---|---|---|---|---|---|
| P2.1 | **Dwell-time** routine kind (mining + alerts + UI) | Medium | Small | Small | Small |
| P2.2 | Routine **templates** + 1-tap apply | Small | Small | Small | Small |

### Phase 3 — Safety v2

| Sub | Title | Server | iOS | Android | PWA |
|---|---|---|---|---|---|
| P3.1 | **Bedtime/curfew** mode (per-user schedule + away-from-home alerts) | Medium | Small | Small | Small |
| P3.2 | **Low-battery** push alerts (opt-in per watcher) | Small | Small | Small | Small |
| P3.3 | **Emergency contacts** (non-circle SOS escalation, push only) | Medium | Small | Small | Small |

---

## Design decisions (locked-in before implementation)

These prevent the plan from drifting during execution. Confirm before starting:

1. **No new tracking signals.** Dwell routines, curfew, low-battery, and emergency contacts all derive from data the server already collects (`visits`, `locations.battery_pct`, `sos_events`). No new client-side sensors or background-permission asks.
2. **iOS parity work changes zero server endpoints.** P1.1–P1.3 are pure client work — every endpoint already exists from Sprints 5–6. If a sub-feature needs new server work, it's a bug in the iOS port, not a missing endpoint.
3. **iOS App.tsx stays single-file.** Don't refactor mid-sprint. Add new screens as components alongside `MapTab`, `MembersTab`, etc. — same pattern as the existing `MoreTab` settings extraction.
4. **Dwell routines are a third `kind`, not a separate table.** The `routines.kind` CHECK constraint becomes `IN ('arrival','departure','dwell')`. Add one column `expected_dwell_minutes INTEGER` (NULL for arrival/departure). The mining logic gets a third bucket; the alert sweep gets a fourth alert kind (`overstay_dwell`). Reuse confidence + tolerance machinery as-is.
5. **Routine templates are a constant array on the server, not a DB table.** Five seeded templates: "School day", "Work commute (weekday)", "School pickup", "Weekend church", "Late-night curfew". `GET /api/routine-templates` returns them; `POST /api/users/me/routines/from-template` instantiates one. Templates can be edited in code without a migration.
6. **Curfew is a per-user setting, not per-circle.** A user (or their guardian, with admin role) sets curfew on their own `alert_prefs`. If active and `nowLocalMinute` is in `[curfew_start, curfew_end]` and the user is NOT inside the geofence of their `curfew_home_place_id`, fire `curfew_violation` to circle members. One alert per night per user (UNIQUE on `(user_id, fired_local_date)` in `routine_alerts`-style table).
7. **Curfew reuses the existing `routine_alerts` table**, with a new alert kind `curfew_violation`. Don't introduce a parallel table. Extend the CHECK constraint via recreate-migration the same way P2.1 does for `routines.kind`.
8. **Low-battery alerts are edge-triggered, not level-triggered.** Fire once when the member's battery transitions from `≥threshold` to `<threshold`. Don't fire again until it recovers above `threshold + 5` (hysteresis) and drops below again. Track last-fired state in memory (`Map<userId, {firedFor: battery_pct, recovered: bool}>`) — restart-safe because batteries cycle in <24h.
9. **Emergency contacts are existing app users**, looked up by email. The contact must accept the invitation (a `pending` row becomes `accepted` after the contact taps a deep link). On SOS fire (Sprint 4 already wires this), the server additionally `fanOut`s to the accepted contacts' FCM tokens with a push that says "$NAME triggered SOS." **The contact gets zero location visibility** — just the push. They can call/text back through whatever channel they already have. This is the "no SMS, no email, push-only" trade-off from `SPRINT_5_PLAN.md` decision #10 applied to escalation.
10. **iOS pod fragility carryover:** do not add `expo-av`, `expo-camera`, or any new native module in this sprint. Reuse `expo-notifications` for any audio cue (it has a system sound channel) — same constraint as Sprint 4.12.
11. **Privacy framing.** Every new alert kind (`overstay_dwell`, `curfew_violation`, `low_battery`) is opt-in for the watcher in `alert_prefs`. Subject-side controls (pause sharing, routines_enabled global toggle) continue to suppress all of them.
12. **No new WS events for P1.** P2.1's `overstay_dwell` and P3.1's `curfew_violation` use the existing `routine_deviation` event with a `kind` field. P3.2 adds one new event `low_battery` (lightweight). P3.3 reuses `sos_active` — emergency contacts get the same payload as circle members.

---

## P1.1 — iOS RoutinesScreen

**No server changes.** Every endpoint exists from Sprint 5: `GET /api/users/:userId/routines`, `PATCH /api/routines/:id`, `DELETE /api/routines/:id`, `GET/PATCH /api/users/me/routine-prefs`, `POST /api/users/me/routines`.

**iOS** (`ios-app/App.tsx`)

- New types alongside existing `Member`:
  ```ts
  type RoutineKind = 'arrival' | 'departure' | 'dwell';
  type Routine = {
    id: number; userId: number; circleId: number; placeId: number; placeName: string;
    kind: RoutineKind; dayOfWeek: number; expectedMinute: number;
    expectedDwellMinutes: number | null;       // P2.1 — null until then
    toleranceMinutes: number; sampleCount: number; confidence: number;
    source: 'auto' | 'manual'; active: boolean;
    lastSeenAt: number | null;
  };
  type RoutinePrefs = { routinesEnabled: boolean; quietStart: number | null; quietEnd: number | null };
  ```
- New `<RoutinesScreen>` component, opened from `MoreTab` → existing "Smart routines" row (currently only renders a toggle — extend to navigate into the screen on tap).
- Screen layout (mirror Android `RoutinesScreen.kt`):
  - Header: "Routines we've noticed about your week" + global routines-enabled toggle.
  - Section "Active routines": one card per routine grouped by place, showing day chip(s), expected time (`formatMinuteOfDay`), tolerance (`±15 min`), confidence badge (`Strong` ≥0.8, `Moderate` ≥0.6, else `Learning`), source pill (`Auto` / `Manual`).
  - Per-card actions: toggle active, edit tolerance (slider 5–60 min), edit expected time (time picker — flips `source` to `manual`), delete (long-press confirm).
  - Section "Other family members": collapsed list of routines the viewer has seen on shared members (read-only view, links to that member's page) — same data path, fetched per-member.
  - FAB "+ Add routine" → opens a half-sheet form: place picker (from circle's places), kind picker (arrival/departure — dwell becomes available after P2.1), day-of-week chips, time picker, tolerance slider. Submits to `POST /api/users/me/routines`.
- Use existing `api<T>(session, path, init)` wrapper. Use existing fetch-on-WS-event pattern from `HealthStrip` — refresh on `routine_deviation`.
- Reuse `useState` + `FlatList` patterns from `MembersTab`. No new dependencies.

### P1.1 acceptance

- Open Routines screen on a fresh iOS install with Sprint 5 data present → list renders, grouped by place, in time order.
- Toggle a routine off → server `PATCH`, screen reflects within 500 ms, Android user sees the routine vanish from their list (WS not needed; Android refetches on focus).
- Manual add: pick a place, set 8:15 weekday arrival → row appears, `source = manual`, no observation gate.
- Delete: long-press, confirm, row disappears; verify `active = 0` server-side.

**Pause for human verification.**

---

## P1.2 — iOS Weekly Digest detail

**No server changes.** Endpoints exist: `GET /api/circles/:circleId/digest/current`, `GET /api/circles/:circleId/digest?since=`, `PATCH /api/users/me/digest-prefs`.

**iOS** (`ios-app/App.tsx`)

- New types:
  ```ts
  type DigestSnapshot = {
    id: number; circleId: number; weekStart: number; weekEnd: number;
    summary: {
      members: Array<{ userId: number; displayName: string;
        trips: { count: number; totalKm: number; maxSpeedKph: number };
        visits: { count: number; topPlaces: Array<{ name: string; dwellMs: number }> };
        routines: { fires: number; misses: number };
        drivingScore: number | null;
        checkins: number;
      }>;
      circle: { totalKm: number; totalAlerts: number; busiestPlace: string | null; quietestMember: string | null };
    };
    createdAt: number;
  };
  ```
- **"This week" card** in `MapTab` above the map (matches Android `MapScreen.kt` placement). Renders one-line per member ("Sarah: 3 trips, 47 km · 1 missed routine"). Pulls from `/digest/current`. Card hidden if no snapshot exists. Tap card → push `<DigestScreen>`.
- **`<DigestScreen>`** (new): renders all members' full breakdown with collapsible per-member cards. Bottom row: circle totals. Bottom action: "View past weeks" → flat list from `/digest?since=ms_12_weeks_ago` with cards date-stamped.
- **Toggle in `MoreTab`**: the existing "Weekly digest" row already exists from Sprint 6 — confirm it correctly calls `PATCH /api/users/me/digest-prefs`. If not, fix.
- **WS event handling**: on `digest_ready`, refetch `/digest/current` and re-render the card. Reuse existing `useEffect` event router.

### P1.2 acceptance

- With a Sprint 6 digest snapshot in the DB → "This week" card renders on Map tab.
- Tap card → DigestScreen pushes; per-member breakdown matches the snapshot's `summary_json`.
- "View past weeks" loads 12 most-recent snapshots; oldest visible date matches expectation.
- Force a new digest run (seed DB or wait for Sunday) → card refreshes via `digest_ready` WS event without manual reload.

**Pause for human verification.**

---

## P1.3 — iOS dedicated TripsScreen

**No server changes.** Endpoint: `GET /api/circles/:circleId/members/:userId/trips` (already returns `mode`, `started_at`, `ended_at`, `distance_m`, `max_speed_mps`, `event_count`).

**iOS** (`ios-app/App.tsx`)

- New `<TripsScreen>` component, opened from `MembersTab` → "Driving Safety" section → new "View all trips" link (currently trips are buried under inline lists).
- Layout mirrors Android `TripsScreen.kt`:
  - Top filter chips: 7d / 30d / 90d.
  - Per-trip card: start/end time (relative + absolute), duration, distance (km), max speed (km/h with color: green <speed_limit_mps, amber +10%, red +20%), mode icon (drive / walk / bike).
  - Tap card → existing trip detail modal (already in iOS) OR if not present, a simple expand-in-place with point count and any speeding/braking event markers.
  - Empty state copy: "No trips in this range."
- Reuse `formatRelative` + `formatDistance` from existing iOS code (search `App.tsx` for `formatRelative` — already defined).
- Pull-to-refresh.

### P1.3 acceptance

- Member with 5 trips in last 7 days → screen renders 5 cards in DESC order.
- Range chip 30d → re-fetch happens; correct count.
- Empty member → "No trips in this range." rendered.
- Tap a trip → detail visible (modal or inline).

**Pause for human verification.**

---

## P2.1 — Dwell-time routine kind

**Server**

Migration `server/src/migrations/025_routines_dwell.sql`:

```sql
-- SQLite can't ALTER a CHECK constraint, so recreate the table.
PRAGMA foreign_keys = OFF;
BEGIN;

ALTER TABLE routines RENAME TO routines_old;

CREATE TABLE routines (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    circle_id               INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    place_id                INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    kind                    TEXT    NOT NULL CHECK(kind IN ('arrival','departure','dwell')),
    day_of_week             INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    expected_minute         INTEGER NOT NULL CHECK(expected_minute BETWEEN 0 AND 1439),
    expected_dwell_minutes  INTEGER          CHECK(expected_dwell_minutes IS NULL OR expected_dwell_minutes BETWEEN 5 AND 1439),
    tolerance_minutes       INTEGER NOT NULL CHECK(tolerance_minutes BETWEEN 5 AND 180),
    sample_count            INTEGER NOT NULL DEFAULT 0,
    confidence              REAL    NOT NULL DEFAULT 0,
    source                  TEXT    NOT NULL DEFAULT 'auto' CHECK(source IN ('auto','manual')),
    active                  INTEGER NOT NULL DEFAULT 1,
    first_seen_at           INTEGER,
    last_seen_at            INTEGER,
    last_observed_at        INTEGER,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL,
    UNIQUE (user_id, place_id, kind, day_of_week)
);

INSERT INTO routines (
    id, user_id, circle_id, place_id, kind, day_of_week, expected_minute,
    expected_dwell_minutes, tolerance_minutes, sample_count, confidence,
    source, active, first_seen_at, last_seen_at, last_observed_at, created_at, updated_at
)
SELECT id, user_id, circle_id, place_id, kind, day_of_week, expected_minute,
       NULL, tolerance_minutes, sample_count, confidence,
       source, active, first_seen_at, last_seen_at, last_observed_at, created_at, updated_at
FROM routines_old;

DROP TABLE routines_old;

CREATE INDEX IF NOT EXISTS idx_routines_circle  ON routines(circle_id, active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_routines_subject ON routines(user_id, active)   WHERE active = 1;

-- Extend routine_alerts kind set too.
ALTER TABLE routine_alerts RENAME TO routine_alerts_old;
CREATE TABLE routine_alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id      INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    circle_id       INTEGER NOT NULL REFERENCES circles(id)  ON DELETE CASCADE,
    kind            TEXT    NOT NULL CHECK(kind IN ('missed_arrival','overstay','early_departure','overstay_dwell','curfew_violation')),
    fired_at        INTEGER NOT NULL,
    fired_local_date TEXT   NOT NULL,
    expected_minute INTEGER NOT NULL,
    actual_minute   INTEGER,
    created_at      INTEGER NOT NULL,
    UNIQUE (routine_id, fired_local_date)
);
INSERT INTO routine_alerts SELECT * FROM routine_alerts_old;
DROP TABLE routine_alerts_old;
CREATE INDEX IF NOT EXISTS idx_routine_alerts_circle ON routine_alerts(circle_id, fired_at DESC);

COMMIT;
PRAGMA foreign_keys = ON;
```

(`curfew_violation` is included here too — P3.1 reuses the table and the migration is cheaper combined.)

`server/src/routines.js` extension:
- `mineRoutines(db)` gets a third bucket loop: for each `(user_id, place_id, day_of_week)`, collect visits where `ended_at IS NOT NULL` in the last 30 days. Compute dwell duration per visit (`ended_at - started_at` in minutes). Apply same outlier filter (top/bottom 10% drop if sample_count ≥ 8). Median dwell → `expected_dwell_minutes`. IQR/1.349 → tolerance (clamp 15–60). Confidence formula identical to arrival/departure but using dwell stddev. UPSERT row with `kind = 'dwell'`, `expected_minute` = median start-of-visit minute (so the alert sweep knows when the dwell window opens).
- `evaluateRoutineSweep(db, now)` gets a new branch for `kind = 'dwell'`:
  - For each active dwell routine on today's day-of-week, past observation period:
    - Find today's matching visit (place_id = routine.place_id, started_at within tolerance of expected_minute today, ended_at IS NULL OR ended_at > expected_window_close).
    - Expected window close = `started_at + expected_dwell_minutes + tolerance_minutes` (minutes → ms).
    - If `now > expected_close` and visit is still open → fire `overstay_dwell`. INSERT OR IGNORE with `fired_local_date` UNIQUE.
    - Publish `routine_deviation` WS event with `kind: 'overstay_dwell'`, `expectedDwellMinutes`, `actualDwellMinutes` (= `(now - started_at) / 60_000`).

Update `server/src/payloads.js` `routineDeviationPayload` if it pins kinds — make it pass-through.

**Tests** (`server/test/routines.test.js` extension):
- Seed 6 weekly visits at place_id=1 starting at 14:30, lasting ~120 min ± 10 min → mining produces a `dwell` routine with `expected_minute ≈ 870`, `expected_dwell_minutes ≈ 120`, `tolerance ≈ 15`.
- Seed today's visit starting at 14:35, still open (`ended_at = NULL`) → at `now = today 17:00`, sweep fires `overstay_dwell`. Run sweep again 10 min later → no duplicate.
- Visit ends at 16:35 (within expected window + tolerance) → no fire.

**iOS / Android / PWA**: each Routines screen gets a new pill for `dwell` kind, showing `~ 120 min · ± 15 min` instead of expected-time. Manual-create form gets `dwell` as a kind option (extending P1.1's iOS sheet, Android `RoutinesScreen.kt`, PWA `settings.js`). Reuse existing rendering — only the time format helper changes (`formatDurationMinutes`).

### P2.1 acceptance

- After mine: at least one `kind = 'dwell'` row appears for a seeded scenario.
- Forced sweep at end-of-window with open visit → `overstay_dwell` alert + WS event.
- All three clients render dwell routines correctly (icon, copy "spends ~120 min").
- Existing `arrival` / `departure` routines unaffected by migration (run before/after counts in test).

**Pause for human verification.**

---

## P2.2 — Routine templates + 1-tap apply

**Server**

`server/src/routineTemplates.js` (new — const array, no DB):

```js
export const ROUTINE_TEMPLATES = [
  {
    id: 'school-day',
    title: 'School day',
    description: 'Weekday school arrival + pickup',
    needsPlace: 'school',
    items: [
      { kind: 'arrival',   daysOfWeek: [1,2,3,4,5], expectedMinute: 8 * 60 + 15, toleranceMinutes: 15 },
      { kind: 'departure', daysOfWeek: [1,2,3,4,5], expectedMinute: 15 * 60,     toleranceMinutes: 20 },
    ],
  },
  {
    id: 'work-commute',
    title: 'Work commute (weekday)',
    description: 'Weekday work arrival + departure',
    needsPlace: 'work',
    items: [
      { kind: 'arrival',   daysOfWeek: [1,2,3,4,5], expectedMinute: 9 * 60,      toleranceMinutes: 20 },
      { kind: 'departure', daysOfWeek: [1,2,3,4,5], expectedMinute: 17 * 60 + 30, toleranceMinutes: 30 },
    ],
  },
  {
    id: 'after-school-home',
    title: 'After-school return',
    description: 'Weekday home arrival after school',
    needsPlace: 'home',
    items: [
      { kind: 'arrival', daysOfWeek: [1,2,3,4,5], expectedMinute: 15 * 60 + 30, toleranceMinutes: 30 },
    ],
  },
  {
    id: 'weekend-church',
    title: 'Weekend service',
    description: 'Sunday morning arrival at a place of worship',
    needsPlace: null,                                       // user picks
    items: [
      { kind: 'arrival', daysOfWeek: [0],         expectedMinute: 10 * 60,      toleranceMinutes: 20 },
    ],
  },
  {
    id: 'night-curfew-home',
    title: 'Nightly home-by',
    description: 'Be home by curfew (weeknights)',
    needsPlace: 'home',
    items: [
      { kind: 'arrival', daysOfWeek: [0,1,2,3,4], expectedMinute: 21 * 60,      toleranceMinutes: 30 },
    ],
  },
];
```

New endpoints in `routes/routines.js`:
- `GET /api/routine-templates` — returns the const array. No auth required (public templates).
- `POST /api/users/me/routines/from-template` — body `{ templateId, placeId, customizations?: { expectedMinute?, toleranceMinutes? } }`. Server:
  1. Look up template by `templateId`. 404 if unknown.
  2. Verify `placeId` is in a circle the user belongs to.
  3. For each item in template (with optional customizations applied), call existing `createRoutine` path. Returns array of created routine IDs.
  4. Rate-limit 10/hour.

**Tests** (`server/test/routines.test.js`):
- `POST /from-template` with `school-day` + valid placeId → 10 rows created (2 items × 5 days).
- Same call again → respects existing UNIQUE constraint; returns the upserted set without errors.

**Clients (all three)**: each routines screen's "+ Add routine" button gets a two-tab picker:
- Tab "Templates" (default): list 5 templates. Tap → "Pick a place" step → optional time customizer → "Apply".
- Tab "Custom": existing manual form from P1.1 / Android / PWA.

PWA: `public/settings.js` already has the manual form — wrap in a `<details>` for "Custom" and add a `<select>`-driven template panel above. Use `routeTemplate.needsPlace` to hint default (`home` / `work` / `school`) by name match against the user's places (best-effort string contains).

Android: `RoutinesScreen.kt` add-routine sheet gets a `TabRow` with two tabs. Reuse existing `PlacePickerDropdown` and `TimePicker` composables.

iOS: P1.1's add-routine half-sheet gets a segmented control at the top. Reuse the rest.

### P2.2 acceptance

- `GET /api/routine-templates` returns 5 templates.
- Applying `school-day` template with `placeId=1` creates 10 routines (5 weekdays × 2 kinds). All `source = manual`.
- Applying same template twice → no duplicates, no errors.
- Each client surfaces templates first; user can fall through to custom form.

**Pause for human verification.**

---

## P3.1 — Bedtime/curfew mode

**Server**

Migration `server/src/migrations/026_curfew.sql`:

```sql
ALTER TABLE alert_prefs ADD COLUMN curfew_enabled        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_prefs ADD COLUMN curfew_start          INTEGER;   -- minute of day, e.g. 22*60 = 1320
ALTER TABLE alert_prefs ADD COLUMN curfew_end            INTEGER;   -- minute of day, e.g. 7*60  = 420
ALTER TABLE alert_prefs ADD COLUMN curfew_home_place_id  INTEGER REFERENCES places(id) ON DELETE SET NULL;
```

(`routine_alerts` already supports `curfew_violation` via the P2.1 migration.)

`server/src/curfew.js` (new):
- `export function evaluateCurfewSweep(db, now = Date.now())`:
  - SELECT users with `alert_prefs.curfew_enabled = 1 AND curfew_start IS NOT NULL AND curfew_end IS NOT NULL AND curfew_home_place_id IS NOT NULL`.
  - For each: compute user's local time (reuse `estimateLocalOffsetMinutes(lng)` from `drivingScore.js`; fall back to server-local if no recent location).
  - Compute `nowLocalMinute`. Check whether it falls inside `[curfew_start, curfew_end]` (wrap-aware for ranges that cross midnight — reuse `inQuietHours` helper from `quietHours.js`).
  - If outside curfew window: skip.
  - If subject paused: skip.
  - Query current `place_presence` for subject: are they inside `curfew_home_place_id`? If yes, skip.
  - Compute `fired_local_date` for today (or yesterday if current local hour < curfew_end and curfew wraps midnight).
  - INSERT OR IGNORE INTO routine_alerts (routine_id = 0 sentinel, kind='curfew_violation', user_id, circle_id, fired_at=now, fired_local_date, expected_minute=curfew_start). Note: `routine_id` references routines; for curfew we need to either (a) create a synthetic routine row per user, or (b) allow `routine_id = NULL`. Pick (b): migration adds `routine_id` nullability.

Adjust migration 026 to make `routine_alerts.routine_id` nullable:

```sql
ALTER TABLE routine_alerts RENAME TO routine_alerts_old2;
CREATE TABLE routine_alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id      INTEGER          REFERENCES routines(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    circle_id       INTEGER NOT NULL REFERENCES circles(id)  ON DELETE CASCADE,
    kind            TEXT    NOT NULL CHECK(kind IN ('missed_arrival','overstay','early_departure','overstay_dwell','curfew_violation')),
    fired_at        INTEGER NOT NULL,
    fired_local_date TEXT   NOT NULL,
    expected_minute INTEGER NOT NULL,
    actual_minute   INTEGER,
    created_at      INTEGER NOT NULL,
    UNIQUE (user_id, kind, fired_local_date)   -- changed: dedup by (user, kind, date), not routine
);
INSERT INTO routine_alerts (id, routine_id, user_id, circle_id, kind, fired_at, fired_local_date, expected_minute, actual_minute, created_at)
SELECT id, routine_id, user_id, circle_id, kind, fired_at, fired_local_date, expected_minute, actual_minute, created_at FROM routine_alerts_old2;
DROP TABLE routine_alerts_old2;
CREATE INDEX IF NOT EXISTS idx_routine_alerts_circle ON routine_alerts(circle_id, fired_at DESC);
```

Note: the new UNIQUE `(user_id, kind, fired_local_date)` replaces `(routine_id, fired_local_date)` and works for both routine-derived alerts and synthetic curfew alerts. Re-verify P2.1 tests with this change.

- On first-fire-today: `publish(circleId, {type: 'routine_deviation', userId, displayName, kind: 'curfew_violation', curfewStart, curfewEnd, currentPlaceName})`. `fanOut(circleId, payload, db, userId)`.

Scheduler wiring in `server/src/scheduler.js`:
- `curfewSweepHandle = setInterval(curfewTick, 5 * 60_000)` — every 5 minutes is sufficient (curfew violation isn't a sub-minute concern).
- Try/catch with Pino log on failure (`curfew_sweep_failed`).

New endpoints in `routes/alertPrefs.js`:
- Extend existing `GET /api/users/me/alert-prefs` response to include `curfewEnabled`, `curfewStart`, `curfewEnd`, `curfewHomePlaceId`.
- Extend existing `PATCH /api/users/me/alert-prefs` to accept those four fields. Validate: `curfewStart` and `curfewEnd` in [0, 1439]; `curfewHomePlaceId` is a place in one of the user's circles.

**Tests** (`server/test/curfew.test.js`, new):
- User with curfew 22:00–06:00, home=place_id=1. Simulated `now = 23:30 local`, member presence at place_id=2 → fire `curfew_violation`.
- Simulated `now = 23:30 local`, member presence at place_id=1 (home) → no fire.
- Same conditions, paused subject → no fire.
- Same scenario at `now = 23:35` (5 min later) → no duplicate.
- Midnight-wrap: curfew 22:00–06:00, `now = 02:30 local`, member NOT at home → fire (with `fired_local_date` = today, since 02:30 is "tonight" of yesterday's curfew).

**Clients (all three)**: new "Curfew" section in account/settings screen.
- Toggle "Enable curfew alerts".
- Time pickers for start + end.
- Place picker for "home" (filter user's circles' places).
- Copy: "Family Guardian will alert your circle if you're not at home during these hours. You can pause sharing to suppress."
- iOS: add to `MoreTab` settings. Android: `AccountScreen.kt`. PWA: `settings.html` + `settings.js`.

### P3.1 acceptance

- API: `PATCH /api/users/me/alert-prefs` with curfew fields persists; `GET` returns same.
- With curfew 22:00–06:00 + home place set, simulated subject at non-home place at 23:00 → `curfew_violation` WS event arrives at other circle members + FCM push fires.
- Subject inside home place during curfew → no event.
- Repeated sweep within same night → no duplicate.
- All three clients render curfew settings and save without server error.

**Pause for human verification.**

---

## P3.2 — Low-battery push alerts

**Server**

Migration `server/src/migrations/027_low_battery.sql`:

```sql
ALTER TABLE alert_prefs ADD COLUMN low_battery_alerts    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_prefs ADD COLUMN low_battery_threshold INTEGER NOT NULL DEFAULT 15;
```

Logic: extend `server/src/routes/locations.js` `POST /api/locations` handler:
- After existing geofence reconciliation, check `battery_pct` field.
- Compare against previous battery in in-memory state Map `lastBatteryState` keyed on `userId`:
  - State: `{ pct: number, firedAt: number | null }`.
  - If previous `pct >= threshold` and new `pct < threshold` and (firedAt is null OR firedAt < now - 6h) → fire.
  - "Threshold" = the watching member's `alert_prefs.low_battery_threshold` (per-watcher), not the subject's. So evaluation is per-watcher: for each circle member with `low_battery_alerts = 1`, evaluate against THEIR threshold and fire only to them.
  - Actually simpler: subject has a single `effective_threshold` = max of watchers' thresholds (so we fire on the most permissive watcher's threshold). Then on fire, fan out only to watchers whose `low_battery_alerts = 1` and `threshold >= subject_pct`. **Use this approach** — single state per subject, watcher-side filter at fanOut time.
- On fire: `publish(circleId, {type: 'low_battery', userId, displayName, batteryPct, recordedAt})`. `fanOut` with watcher filter.
- Hysteresis: when subject's `pct` rises above `threshold + 5`, clear `firedAt`. This makes the next dip re-arm the alert.
- State persists in memory only — restart loses it, which is acceptable (worst case: one duplicate push after restart). Document.

New endpoints in `routes/alertPrefs.js`:
- Extend `GET /api/users/me/alert-prefs` and `PATCH /api/users/me/alert-prefs` to accept `lowBatteryAlerts` and `lowBatteryThreshold` (range [5, 50]).

**Tests** (`server/test/low_battery.test.js`, new):
- Seed alert_prefs with `low_battery_alerts=1, threshold=20`. POST locations with battery 30 → no event. POST with battery 15 → `low_battery` WS event fires once. POST 14, 13, 10 → no more events. POST 28 → still no event (hysteresis). POST 35 → state clears. POST 10 → fires again.

**Clients (all three)**: account-screen toggle + threshold picker (slider 10–50%, step 5%).
- iOS: `MoreTab` → "Low-battery alerts" toggle + slider.
- Android: `AccountScreen.kt`.
- PWA: `settings.html` + `settings.js`.

Optionally on the Health widget (Sprint 6 H1): the battery icon already turns red below threshold — confirm or add color logic to match each watcher's threshold (best-effort: use watcher's own threshold, fall back to 20%).

### P3.2 acceptance

- Toggle low-battery alerts ON, set threshold to 20%.
- Subject's app posts battery 30% → 25% → 20% → 15% → only one `low_battery` push received.
- Subject's battery recovers to 30% → state clears.
- Subject drops to 10% again → one more push.
- Toggle OFF → no pushes regardless of subject battery.

**Pause for human verification.**

---

## P3.3 — Emergency contacts (non-circle SOS escalation)

**Server**

Migration `server/src/migrations/028_emergency_contacts.sql`:

```sql
CREATE TABLE IF NOT EXISTS emergency_contacts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
    invited_at      INTEGER NOT NULL,
    accepted_at     INTEGER,
    UNIQUE (user_id, contact_user_id)
);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user    ON emergency_contacts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_contact ON emergency_contacts(contact_user_id, status);
```

New routes in `routes/emergencyContacts.js`:
- `GET /api/users/me/emergency-contacts` — returns the user's own list, with `{id, contactUserId, contactDisplayName, contactPhotoUrl?, status, invitedAt, acceptedAt}`. ACL: self only.
- `POST /api/users/me/emergency-contacts` — body `{email}`. Server:
  1. Look up user by email. 404 with friendly copy if not found ("They need to install Family Guardian first").
  2. Look up existing `emergency_contacts` row. If exists with `status='accepted'`: 409. If `revoked`: re-create as pending.
  3. INSERT pending row.
  4. `fanOut(null, {type: 'emergency_contact_invite', fromUserId, fromDisplayName}, db, contactUserId)` — single-user push so the invitee gets notified immediately.
- `POST /api/users/me/emergency-contacts/:id/respond` — body `{action: 'accept' | 'revoke'}`. ACL: contact_user_id must be the caller. Sets status accordingly.
- `DELETE /api/users/me/emergency-contacts/:id` — soft delete (status='revoked'). ACL: either party.
- `GET /api/users/me/pending-invites` — returns invites where caller is the contact_user_id and status='pending'.

Wire into `index.js`. Rate-limit POST endpoints at 30/hour.

Extend `routes/sos.js` `POST /api/sos/activate`:
- After existing `fanOut` to circle members, additionally `fanOut` to `emergency_contacts` where `user_id = subjectId AND status = 'accepted'`, with the same payload BUT with `placeName` and `lat/lng` stripped (emergency contacts get push only, no location). Payload shape: `{type: 'sos_active', userId, displayName, activatedAt, viaEmergencyEscalation: true}`.
- Audit: `logView(db, contactUserId, subjectId, 'sos_escalation')` for each contact pinged.

Extend `audit.js` `VALID_RESOURCES` to include `'sos_escalation'`.

**Tests** (`server/test/emergency_contacts.test.js`, new):
- A invites B by email → pending row created, B's FCM mock receives `emergency_contact_invite`.
- B accepts → status='accepted'.
- A activates SOS → B's FCM receives `sos_active` push with `viaEmergencyEscalation=true`, no `lat/lng` in payload.
- B is NOT in A's circle — verify B doesn't see A's location via any other endpoint (call `GET /api/circles/:id/members` as B → 403 / B not present).
- A revokes contact → SOS no longer fans out to B.

**Clients (all three)**: new "Emergency contacts" section in account screen.
- iOS: `MoreTab` → "Emergency contacts" row → push `<EmergencyContactsScreen>` (new). Add-by-email form, list with status badges, accept/revoke actions for pending invites coming IN.
- Android: `AccountScreen.kt` → "Emergency contacts" row → `ui/EmergencyContactsScreen.kt` (new).
- PWA: `settings.html` → new section.
- Each client: on `emergency_contact_invite` WS event (received via `/ws` regardless of circle), show a system notification "X wants you as an emergency contact" with accept/dismiss inline actions.

### P3.3 acceptance

- A invites B by email; B gets push notification + sees pending invite in their app.
- B accepts; A sees "accepted" badge.
- A triggers SOS → B gets push (regardless of being in A's circle).
- B's push payload contains NO lat/lng (verify via push body inspection in test).
- B cannot read A's location through any other endpoint (membership ACL holds).
- A revokes → next SOS does not page B.

**Pause for human verification.**

---

## Files — created

```
server/src/migrations/025_routines_dwell.sql       <- P2.1 dwell kind + routine_alerts kind extension
server/src/migrations/026_curfew.sql               <- P3.1 alert_prefs columns + routine_alerts unique-key change
server/src/migrations/027_low_battery.sql          <- P3.2 alert_prefs columns
server/src/migrations/028_emergency_contacts.sql   <- P3.3 emergency_contacts table
server/src/routineTemplates.js                     <- P2.2 const array of templates
server/src/curfew.js                               <- P3.1 sweep logic
server/src/routes/emergencyContacts.js             <- P3.3 endpoints
server/test/curfew.test.js                         <- P3.1 unit tests
server/test/low_battery.test.js                    <- P3.2 unit tests
server/test/emergency_contacts.test.js             <- P3.3 unit tests
android/app/src/main/java/com/familyguardian/ui/EmergencyContactsScreen.kt    <- P3.3 Android UI
android/app/src/main/java/com/familyguardian/data/EmergencyContactsRepo.kt    <- P3.3 Android data
```

## Files — modified

```
server/src/routines.js                  <- P2.1 dwell mining + sweep; P2.2 template instantiation helper
server/src/routes/routines.js           <- P2.2 /routine-templates + /from-template endpoints
server/src/routes/locations.js          <- P3.2 low-battery edge detection in POST /locations
server/src/routes/sos.js                <- P3.3 emergency-contact fanOut on SOS
server/src/routes/alertPrefs.js         <- P3.1 curfew fields; P3.2 low-battery fields
server/src/audit.js                     <- P3.3 add 'sos_escalation' to VALID_RESOURCES
server/src/scheduler.js                 <- P3.1 curfewTick (5-min interval)
server/src/index.js                     <- register emergencyContacts route
server/src/public/settings.js           <- P2.2 templates picker; P3.1 curfew form; P3.2 battery toggle; P3.3 contacts section
server/src/views/settings.html          <- P2.2 / P3.1 / P3.2 / P3.3 sections
android/app/src/main/java/com/familyguardian/data/Models.kt           <- DTOs: Dwell field, RoutineTemplate, CurfewPrefs, EmergencyContact
android/app/src/main/java/com/familyguardian/ui/RoutinesScreen.kt     <- P2.1 dwell rendering; P2.2 templates tab
android/app/src/main/java/com/familyguardian/ui/AccountScreen.kt      <- P3.1 curfew form; P3.2 battery toggle; P3.3 contacts row
android/app/src/main/java/com/familyguardian/events/GuardianEvent.kt  <- LowBattery variant; EmergencyContactInvite variant
android/app/src/main/java/com/familyguardian/events/Alerts.kt         <- showLowBattery, showCurfewViolation, showEmergencyContactInvite
android/app/src/main/java/com/familyguardian/MainActivity.kt          <- WS routing for new events
ios-app/App.tsx                                                       <- P1.1 RoutinesScreen, P1.2 DigestScreen + this-week card, P1.3 TripsScreen, P2.1 dwell pill + form option, P2.2 templates picker, P3.1 curfew form, P3.2 battery toggle, P3.3 EmergencyContactsScreen + WS handler
README.md                                                             <- Sprint 7 section + API table updates
AGENTS.md                                                             <- new tables + WS events + alert kinds
```

## Reused (no edit, just import)

- `publish()` from `hub.js` and `fanOut()` from `fcm.js` — same pattern as `alerts.js`.
- `logView()` from `audit.js` — for P3.3 SOS escalation (new resource `'sos_escalation'` added).
- `estimateLocalOffsetMinutes(lng)` from `drivingScore.js` — P3.1 curfew local-time estimate.
- `inQuietHours(startMin, endMin, nowLocalMin)` from `quietHours.js` — P3.1 midnight-wrap handling.
- `requireCircleMembership` ACL pattern from `routes/visits.js` / `routes/trips.js`.
- Sprint 5 `mineRoutines` + `evaluateRoutineSweep` — P2.1 extends in place.
- Sprint 6 `digest.js` payload shape — P1.2 iOS just renders it.
- Existing iOS `api<T>()` wrapper + WS `useEffect` router — all new iOS work plugs in.
- Existing Android `data/*Repo.kt` pattern (HealthRepo, RoutinesRepo, DigestRepo) — P3.3 mirrors.
- Android `Alerts.kt` channel pattern (`CHANNEL_NORMAL` for curfew/low-battery/invite; `CHANNEL_SOS` reused for escalation).
- iOS `Notifications.scheduleNotificationAsync` (already wired for SOS / geofence / routines).
- PWA `avatarInner(m)` helper for contact list items.

---

## Recommended execution order

Three phases, executed in order. Each phase's verification gate is independent — if Phase 1 takes longer than expected, Phases 2–3 can be deferred to Sprint 8 without rework.

### Phase 1 — iOS parity (no server changes; fast)

1. **P1.1 iOS RoutinesScreen** — most-noticed gap. Pure client work. Smoke-test against existing routine data on the live server.
2. **P1.2 iOS Weekly Digest detail + this-week card.**
3. **P1.3 iOS dedicated TripsScreen.**

**Pause for human verification after P1.3.** Snapshot the iOS app, decide whether to continue into Phase 2 this sprint or split.

### Phase 2 — Routines v2

4. **P2.1 server migration + dwell mining + sweep + tests.** Migration is the riskiest part — verify on a copy of the dev DB (NOT the prod docker volume) before applying.
5. **P2.1 all three clients** — render dwell kind, add dwell to manual-create form.
6. **P2.2 server template endpoint + tests.**
7. **P2.2 all three clients** — templates picker.

**Pause for human verification.**

### Phase 3 — Safety v2

8. **P3.1 server migration + curfew sweep + tests.** Schema change touches `routine_alerts` UNIQUE key — re-run P2.1 tests after migration.
9. **P3.1 all three clients** — curfew settings UI.
10. **P3.2 server migration + low-battery hysteresis + tests.**
11. **P3.2 all three clients** — battery toggle + threshold.
12. **P3.3 server migration + emergency_contacts routes + SOS fanOut extension + tests.**
13. **P3.3 all three clients** — EmergencyContactsScreen + WS invite handler.

**Pause for human verification after each P3.x.**

### Wrap-up

14. README + AGENTS.md updates (new tables, new endpoints, new WS events, new alert kinds).
15. Final smoke pass on isolated test instance (different container name, different port, **separate volume** — never wipe the dev/prod volume per house-rule).

---

## Verification (end-to-end)

**Setup — isolated test instance** (per house-rule about never wiping the dev/prod docker volume):

```bash
# Spin up an isolated test instance — separate name, port, volume.
cd "h:/family-guardian/server"
# DO NOT touch existing data/ — use a temp dir.
TEST_DIR="$(mktemp -d)/fg-sprint7-test"
mkdir -p "$TEST_DIR"
DATABASE_PATH="$TEST_DIR/test.db" PORT=8766 npm start &
SERVER_PID=$!
until curl -sf http://127.0.0.1:8766/healthz >/dev/null 2>&1; do sleep 1; done
echo "READY pid=$SERVER_PID dir=$TEST_DIR"

# Bootstrap signup, get TOKEN (per HANDOFF.md snippet).
# Create a circle, place "Home", place "School", invite a second user.
```

### Phase 1 — iOS parity (no curl checks; UI verification only)

- Launch iOS app on Expo Go pointed at the test server.
- **P1.1**: Seed routines via `POST /api/users/me/routines` from curl, then open Routines screen on iOS → routines appear, toggle/edit/delete work.
- **P1.2**: Force a digest run by seeding `digest_snapshots` directly (see SPRINT_6_PLAN.md "H5 force-run" snippet). Open MapTab on iOS → "This week" card visible. Tap → DigestScreen renders breakdown.
- **P1.3**: Seed 3 trips for a member, open MembersTab → Driving Safety → View all trips → TripsScreen renders.

### Phase 2 — Routines v2

```bash
# P2.1 — verify dwell migration applied:
sqlite3 "$TEST_DIR/test.db" "SELECT sql FROM sqlite_master WHERE name='routines';" | grep -q "dwell" && echo "P2.1 schema OK"

# P2.1 — seed dwell visits + force mine:
node -e "
const Database = require('h:/family-guardian/server/node_modules/better-sqlite3');
const db = new Database('$TEST_DIR/test.db');
const now = Date.now();
// 6 weekly Saturday afternoon visits to place 1, ~120 min dwell.
for (let w = 0; w < 6; w++) {
  const startMs = now - (w * 7 + 1) * 86400_000 + 14 * 3600_000 + 30 * 60_000;
  db.prepare('INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (1,1,1,0,0,?,?,5)')
    .run(startMs, startMs + (120 + Math.random()*10) * 60_000);
}
"
# Force mine via debug endpoint OR restart server.
sqlite3 "$TEST_DIR/test.db" "SELECT kind, expected_minute, expected_dwell_minutes FROM routines WHERE kind='dwell';"

# P2.2 — templates endpoint + apply:
curl -s http://127.0.0.1:8766/api/routine-templates | jq '.[].id'
curl -sX POST http://127.0.0.1:8766/api/users/me/routines/from-template \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"templateId":"school-day","placeId":2}' | jq .
sqlite3 "$TEST_DIR/test.db" "SELECT COUNT(*) FROM routines WHERE source='manual';"
```

### Phase 3 — Safety v2

```bash
# P3.1 — set curfew, then simulate violation
curl -sX PATCH http://127.0.0.1:8766/api/users/me/alert-prefs \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"curfewEnabled":true,"curfewStart":1320,"curfewEnd":420,"curfewHomePlaceId":1}'
# Post a location fix outside the home geofence at simulated curfew time
#   (either tweak server clock, or modify curfew_start to current local minute - 5 for test).
# Verify WS event + push fan-out from server logs.
sqlite3 "$TEST_DIR/test.db" "SELECT kind, fired_local_date FROM routine_alerts WHERE kind='curfew_violation';"

# P3.2 — low-battery cycle
curl -sX PATCH http://127.0.0.1:8766/api/users/me/alert-prefs \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"lowBatteryAlerts":true,"lowBatteryThreshold":20}'
# Subject posts locations with battery 30, 25, 20, 15, 10:
for B in 30 25 20 15 10; do
  curl -sX POST http://127.0.0.1:8766/api/locations \
    -H "Authorization: Bearer $SUBJECT_TOKEN" -H "Content-Type: application/json" \
    -d "{\"lat\":0,\"lng\":0,\"batteryPct\":$B,\"recordedAt\":$(date +%s%3N)}"
done
# Verify ONLY ONE low_battery push fired (check server logs OR FCM mock).
# Subject posts 35 → state clears. Then 10 → one more push.

# P3.3 — emergency contact invite + SOS
# Invite by email:
curl -sX POST http://127.0.0.1:8766/api/users/me/emergency-contacts \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"contact@example.test"}'
# Contact accepts (logged in as contact):
INVITE_ID=$(curl -sH "Authorization: Bearer $CONTACT_TOKEN" http://127.0.0.1:8766/api/users/me/pending-invites | jq '.[0].id')
curl -sX POST "http://127.0.0.1:8766/api/users/me/emergency-contacts/$INVITE_ID/respond" \
  -H "Authorization: Bearer $CONTACT_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"accept"}'
# Subject activates SOS:
curl -sX POST http://127.0.0.1:8766/api/sos/activate \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
# Verify: server logs show fanOut to contact's tokens. Push payload omits lat/lng.
```

### Tear-down — preserve all prod/dev data

```bash
kill $SERVER_PID
rm -rf "$TEST_DIR"
# IMPORTANT: do NOT touch h:/family-guardian/server/data/  (real data lives there).
# Do NOT run `docker compose down -v` against the dev compose file.
```

**UI smoke** (one rep each, on isolated test server):
- iOS (Expo Go): full P1 verification — Routines, Digest detail, Trips screens.
- Android: open RoutinesScreen → confirm dwell pill renders, template picker appears, dwell visit triggers overstay alert.
- PWA: open settings.html → curfew + low-battery + emergency-contact sections render and save.
- iOS + Android: trigger SOS from subject → confirm circle member + emergency contact both receive push.

---

## Risks & pause points

| Risk | Mitigation |
|---|---|
| Migration 025/026 recreate `routines` and `routine_alerts` tables — risk of data loss or constraint failures | All migrations wrap in BEGIN/COMMIT; test on copy of dev DB first; preserve original rows via `INSERT ... SELECT`; verify row counts match pre/post. **Never run migrations against the prod docker volume during dev iteration** — use isolated test instance. |
| `routine_alerts` UNIQUE key change from `(routine_id, fired_local_date)` to `(user_id, kind, fired_local_date)` may break Sprint 5 dedup if existing rows violate the new key | Migration handles by including all existing rows via INSERT-SELECT; if duplicates surface, P3.1 migration adds an explicit dedup step (`DELETE FROM routine_alerts WHERE id NOT IN (SELECT MIN(id) FROM routine_alerts GROUP BY user_id, kind, fired_local_date)`). Add this DELETE only if real data shows the conflict. |
| iOS App.tsx already exceeds 700 lines — three new screens push it toward 1500 | Don't refactor mid-sprint. Add screens as components in the same file. A dedicated extraction is its own future sprint. |
| Dwell detection produces noisy routines (e.g., 8 hours of sleep at home triggers "long dwell" alerts every night) | The 7-day observation gate + confidence threshold + manual disable still apply. Document in copy: "Dwell routines detect unusual time-at-place; use the toggle to mute ones that aren't useful." |
| Curfew alerts during legitimate sleepover at a friend's house | Subject can pause sharing in advance (existing Sprint 1 feature) — copy in the curfew form reminds. No new mitigation needed. |
| Low-battery state lost on server restart → potential duplicate push | Accepted. Restart is rare; one extra push is harmless. Document. Alternative: persist `last_battery_state` in a tiny table — defer if it becomes a real complaint. |
| Emergency contact invited but never installs the app → invite sits pending forever | Add a `pending_expires_at` (7 days) to migration 028 — actually skipped to keep migration small; sweep is a future polish. Pending invites are visible in caller's UI; they can manually re-invite. |
| Emergency contact accepts and then leaves circle later — they shouldn't keep SOS access | Contact is independent of circle membership. They keep access until subject explicitly revokes. Document in UI copy: "This contact can revoke or you can revoke at any time." |
| Push to non-circle emergency contact reveals subject's display name to a stranger | Subject explicitly invited them by email — that's consent. No location data crosses. Acceptable. |
| FCM disabled (no service account) means SOS escalation is silent on the test server | Same as Sprint 5: WS event still fires, push is logged "FCM disabled". Document. Doesn't block test verification on dev box. |
| Three phases is more scope than a single sprint historically | Each phase has an independent verification gate. If P1 takes the full sprint, P2-P3 defer to Sprint 8 without rework. The sprint can also ship as P1-only if the user prefers a fast checkpoint. |

---

## Open questions (resolve before starting)

1. **iOS digest card placement: above the map (eats screen) or behind a top-bar button (one tap further)?** Recommend behind a button on iOS for parity with the Android approach AND to keep the map dominant. Confirm.
2. **Routine templates: ship with 5 baked-in, or fewer?** Recommend 5 — covers ~80% of common parental use cases.
3. **Curfew: should circle admins (parents) be able to set curfew on a kid's account, or strictly self-set?** Recommend allow-with-audit: an admin PATCH on a member's `/alert-prefs` is allowed, logged via `logView` resource `'curfew_set'`. Kid sees the curfew on their settings page. Confirm.
4. **Low-battery threshold range and default**: plan says default 15%, range [5, 50]. Confirm.
5. **Emergency contact: max number per user?** Recommend cap at 5 to prevent SOS-spam abuse. Enforce in `POST /api/users/me/emergency-contacts`.
6. **iOS RoutinesScreen accessed from `MoreTab`'s existing "Smart routines" toggle, or a new dedicated tab?** Recommend keep existing toggle as toggle, add a separate "Manage routines →" row beneath it that pushes the screen. Avoid restructuring tab bar mid-sprint.
7. **`POST /api/users/me/routines/from-template` — should it skip already-existing routines or replace?** Recommend skip silently (UNIQUE constraint already enforces); response includes both `created` and `skipped` lists. Confirm.

These don't block implementation start — settle during P1.1 / P3.x work.

---

## House rules carryover (locked-in by `NEXT_SPRINT_PROMPT.md` and prior sprint plans)

- One focused theme per sprint. Don't add features beyond scope. Don't over-engineer.
- TaskCreate/TaskUpdate for multi-step work. One task `in_progress` at a time.
- Test on a live server (isolated test instance) before claiming a sub-feature done.
- Pause for human verification after each sub-feature.
- No commits without ask. No pushes, ever.
- ESM `.js` extensions on local imports. Synchronous `db.transaction(() => {})()`. Pino structured logs.
- Raw-replace before safe-replace in `routes/web.js` template render. Don't reorder.
- **Never wipe the docker volume or on-device app data without explicit in-the-moment permission.** Always use isolated test instances (separate name, port, volume).

---

## Critical files to read first when implementing

- `SPRINT_5_PLAN.md` — routines schema, mining/sweep patterns. P2.1 directly extends.
- `SPRINT_6_PLAN.md` — digest payload shape, scheduler tick pattern. P1.2 / P3.1 reuse.
- `HANDOFF.md` — repo conventions; template render-order trap; ESM `.js` import rule; test instance workflow.
- `server/src/routines.js` — P2.1 extension target (mining + sweep).
- `server/src/scheduler.js` — P3.1 curfew tick target; existing `routineSweepHandle` pattern.
- `server/src/routes/routines.js` — P2.2 endpoints; P1.1 reuse target (no changes).
- `server/src/routes/locations.js` — P3.2 battery edge-detection in POST handler.
- `server/src/routes/sos.js` — P3.3 fanOut extension target.
- `server/src/routes/alertPrefs.js` — P3.1 + P3.2 field extensions.
- `server/src/audit.js` — P3.3 `VALID_RESOURCES` extension.
- `server/src/digest.js` — P1.2 payload reference (iOS just renders).
- `ios-app/App.tsx` — single-file iOS surface; all P1 work lands here.
- `android/app/src/main/java/com/familyguardian/ui/RoutinesScreen.kt` — P2.1 dwell rendering reference; P2.2 templates tab target.
- `android/app/src/main/java/com/familyguardian/ui/AccountScreen.kt` — P3.1 / P3.2 / P3.3 settings target.
- `server/src/public/settings.js` + `server/src/views/settings.html` — PWA target for all P2.2 / P3.x settings.

---

## Notes for execution

- **Phases are checkpoints**: at each phase boundary (after P1.3, P2.2, P3.3), confirm with user whether to continue or split. Sprints 5 and 6 each shipped 5 sub-features; this sprint shipping 8 is bigger than usual on purpose, because Phase 1 is largely mechanical (iOS port of existing Android UX).
- **Migration ordering** is strict: 025 (P2.1) → 026 (P3.1) → 027 (P3.2) → 028 (P3.3). Each builds on the previous; running out of order produces schema conflicts.
- **Test the routine_alerts UNIQUE-key change carefully**. P2.1 adds the alert kind set; P3.1 changes the UNIQUE key. Re-run all Sprint 5 routine tests after P3.1 to confirm no regressions.
- **Don't add `expo-av`**. P1's audio cue (if needed) uses `expo-notifications` system sound — same constraint as Sprint 4.12.
