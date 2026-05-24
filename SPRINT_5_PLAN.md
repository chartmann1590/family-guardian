# Family Guardian — Sprint 5 Plan: Smart Routines & Deviation

> Paste this whole file into a fresh Claude Code session at `h:\family-guardian` and tell the agent: **"Pick up the Family Guardian work — read SPRINT_5_PLAN.md and continue with G1. Read HANDOFF.md first for repo conventions."**

## Context

**Why this sprint.** Four sprints have shipped — privacy controls, smart notifications, chat polish, driving safety. The visits/trips/places infrastructure has been collecting structured family-schedule data for months but is only surfaced as raw history. A family safety app's real value isn't a map dot; it's *"is everything normal?"* Smart Routines turns the existing visit data into proactive notifications when a family member's routine breaks — kid didn't arrive at school on time, partner unusually late leaving work — without manual setup. This is the most defensibly differentiated feature against Life360 since it requires the visit/place history that's already been collected and only works in a sustained-use installation.

**House-rules carryover** (locked-in by `NEXT_SPRINT_PROMPT.md`):
- One focused theme per sprint. Don't add features beyond scope. Don't over-engineer.
- Test on a live server (not just syntax-check) before claiming a phase done.
- Pause after each sub-feature for human verification before proceeding.
- Don't commit unless asked. Don't push, ever.
- ESM with `.js` extensions, synchronous `db.transaction(() => {})()`, Pino logs.
- Raw-replace before safe-replace in `routes/web.js` template render. Don't reorder.

---

## Roadmap at a glance

| Sprint | Theme | Status |
|---|---|---|
| 1 | Privacy & Control | **Shipped** |
| 2 | Smart Notifications + Reactions | **Shipped** |
| 3 | Chat polish | **Shipped** |
| 4 | Driving safety (crash detection + score) | **Shipped** |
| **5** | **Smart Routines & Deviation** | **This sprint** |

---

## Sprint 5 sub-features

Five sub-features, executed in order. Each has server + client work and a verification gate.

| Sub | Title | Server effort | Client effort |
|---|---|---|---|
| G1 | Routine **detection** (nightly mine of `visits`) | Medium | None |
| G2 | Routine **deviation** alerts (scheduler) | Medium | None directly |
| G3 | Routines **management UI** (list, toggle, delete) | Small | Medium |
| G4 | "**Expected arrivals**" widget | Small | Small |
| G5 | **Manual** routine creation (no auto-detection wait) | Small | Small |

---

### Design decisions (locked-in before implementation)

These prevent the plan from drifting during execution. Confirm before starting:

1. **Source signal = `visits` table with `place_id IS NOT NULL`.** Auto-stays (place_id NULL) are too noisy — only geofenced places (Home, School, Work) participate in routine detection. Trips are not used directly; arrivals/departures are visit edges.
2. **Detection window: 30 days rolling.** Re-mine nightly at 03:00 server local time.
3. **Routine confidence threshold: ≥4 samples, time-of-day stddev ≤45 min, confidence ≥0.7.** Below this, no routine is created.
4. **No alerts until 7-day observation period elapses** for a newly-detected routine. Show it in UI as "learning" first. This prevents week-one false-positive storms.
5. **Tolerance window** = max(15 min, min(60 min, 2 × stddev)). Configurable per routine.
6. **One alert per routine per calendar day**, regardless of how long the deviation lasts.
7. **Routines are per-user, per-place, per-day-of-week.** Three "kinds" defined: `arrival`, `departure`, `dwell` (Sprint 5 ships only `arrival` and `departure`; `dwell` deferred).
8. **Opt-out, not opt-in.** Default `routines_enabled = 1` on `alert_prefs`. Subject user can disable globally. Each routine has its own `active` flag.
9. **Quiet hours respected.** Reuse the same `place_subscriptions` quiet-hours convention (minutes-of-day, wraps midnight). Reuse helper.
10. **No SMS, no email.** Push + WS only. SMS escalation is a Sprint 6 candidate, not this sprint.
11. **Privacy framing.** UI copy is "what we've noticed about your routine" — transparent, deletable. The settings page must show every routine the system has learned about the logged-in user.
12. **Detection is per-individual.** No cross-member pattern correlation (e.g., "Sarah usually arrives 10 min after Bob") — too creepy for v1.

---

## G1 — Routine detection (nightly mine)

**Server**

`server/src/migrations/021_routines.sql`:
```sql
CREATE TABLE IF NOT EXISTS routines (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    circle_id         INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    place_id          INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    kind              TEXT    NOT NULL CHECK(kind IN ('arrival','departure')),
    day_of_week       INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),  -- 0=Sun
    expected_minute   INTEGER NOT NULL CHECK(expected_minute BETWEEN 0 AND 1439),
    tolerance_minutes INTEGER NOT NULL CHECK(tolerance_minutes BETWEEN 5 AND 180),
    sample_count      INTEGER NOT NULL DEFAULT 0,
    confidence        REAL    NOT NULL DEFAULT 0,
    source            TEXT    NOT NULL DEFAULT 'auto' CHECK(source IN ('auto','manual')),
    active            INTEGER NOT NULL DEFAULT 1,
    first_seen_at     INTEGER,
    last_seen_at      INTEGER,
    last_observed_at  INTEGER,        -- last visit observation that matched the routine
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    UNIQUE (user_id, place_id, kind, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_routines_circle   ON routines(circle_id, active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_routines_subject  ON routines(user_id, active)   WHERE active = 1;
```

`server/src/migrations/022_alert_prefs_routines.sql`:
```sql
ALTER TABLE alert_prefs ADD COLUMN routines_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE alert_prefs ADD COLUMN routines_quiet_start INTEGER;  -- minute of day, NULL = no quiet hours
ALTER TABLE alert_prefs ADD COLUMN routines_quiet_end   INTEGER;
```

`server/src/routines.js` (new — mirrors `drivingScore.js` style):
- `export function mineRoutines(db, opts = {})` — full re-mine pass. For each (user_id, place_id, kind, day_of_week) bucket, pull visits in the last 30 days, derive arrival_minute or departure_minute (visit.started_at or visit.ended_at as local-time minute of day, using the lng-based UTC offset estimate that already exists for night driving in `drivingScore.js` — reuse it).
  - Drop top/bottom 10% as outliers if sample_count ≥ 8.
  - Compute median (expected_minute) and IQR.
  - stddev approx = IQR / 1.349. tolerance_minutes = clamp(15, round(2 * stddev), 60).
  - confidence = clamp(0, 1, sample_count / 8) × (1 − min(1, stddev / 45)).
  - UPSERT into `routines` (sample_count, confidence, expected_minute, tolerance_minutes, last_seen_at). Don't overwrite manual-source routines' expected_minute or tolerance.
  - Set `active = 0` for auto-source routines whose `last_seen_at` is older than 14 days.
- Pure function, takes `now` as parameter for testability.

Wire into `server/src/scheduler.js`:
- New tick `mineRoutinesTick(db, log)` running once per day at 03:00 server local time (compute next-run delay each iteration; `setTimeout` rather than `setInterval` to avoid drift).
- Also run once at boot (after migrations finish), debounced to once per 6h via a `_schedule_state` row or in-memory flag.

**No new routes for G1.** Routines become readable via G3's endpoints.

**Tests** (`server/test/routines.test.js`):
- Seed 8 visits over 4 weekdays at place_id=1, started_at ≈ Mon 08:15 ± 5 min. `mineRoutines` should produce a routine with expected_minute ≈ 495 (8:15), tolerance 15, confidence > 0.7.
- Seed 4 visits scattered across times → no routine (stddev too high).
- Manual routine pre-existing → mining preserves its expected_minute/tolerance, only refreshes sample_count.

### G1 acceptance
- Seed 4+ weekday school arrivals via test fixture → run `mineRoutines` → `SELECT * FROM routines` shows the routine with confidence ≥ 0.7.
- Re-run mining → idempotent (no duplicates, UPSERT correctly updates).
- Scheduler logs `routine_mine_complete` with `{routinesCreated, routinesUpdated, routinesDeactivated}` counts.

**Pause for human verification.**

---

## G2 — Deviation alerts

**Server**

`server/src/migrations/023_routine_alerts.sql`:
```sql
CREATE TABLE IF NOT EXISTS routine_alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id      INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    circle_id       INTEGER NOT NULL REFERENCES circles(id)  ON DELETE CASCADE,
    kind            TEXT    NOT NULL CHECK(kind IN ('missed_arrival','overstay','early_departure')),
    fired_at        INTEGER NOT NULL,
    fired_local_date TEXT    NOT NULL,    -- 'YYYY-MM-DD' in user-local tz, for one-per-day dedup
    expected_minute INTEGER NOT NULL,
    actual_minute   INTEGER,              -- NULL if not observed at all
    created_at      INTEGER NOT NULL,
    UNIQUE (routine_id, fired_local_date)
);
CREATE INDEX IF NOT EXISTS idx_routine_alerts_circle ON routine_alerts(circle_id, fired_at DESC);
```

`server/src/routines.js` extension:
- `export function evaluateRoutineSweep(db, now = Date.now())`:
  - For each active routine where `created_at < now - 7*24h` (the observation period gate from decision #4):
    - Skip if subject user is `paused_until > now`.
    - Skip if `alert_prefs.routines_enabled = 0` for subject.
    - Skip if currently in subject's routines quiet hours.
    - Today's local-date in user's timezone (estimate from last-known longitude, same as detection).
    - Today's day_of_week must match routine.day_of_week.
    - Current minute-of-day in user-local tz: `nowLocalMinute`.
    - Trigger-window: `nowLocalMinute >= expected_minute + tolerance_minutes && nowLocalMinute < expected_minute + tolerance_minutes + 60` (60-min firing window so a momentary scheduler skip doesn't drop the alert; UNIQUE constraint handles dedup).
    - For `kind='arrival'`: SELECT visits for (user_id, place_id) where started_at falls within today's window (expected_minute - tolerance to expected_minute + tolerance, in epoch ms). If none, fire `missed_arrival`.
    - For `kind='departure'`: SELECT visits where (started_at < expected_window_start AND (ended_at IS NULL OR ended_at > expected_window_end)). If still inside, fire `overstay`.
    - INSERT OR IGNORE INTO routine_alerts (UNIQUE constraint silently no-ops on duplicate; check `changes` to know if first fire today).
    - On first-fire-today: `publish(circleId, {type: 'routine_deviation', userId, displayName, routineId, placeId, placeName, kind, expectedMinute, actualMinute})` and `fanOut(circleId, ev, db, userId)`.
  - All scoped to one transaction per routine to keep the sweep cheap.

Wire into `scheduler.js`:
- Add `routineSweepHandle = setInterval(routineTick, 60_000)` next to the existing pause/offline ticks.
- Wrap with try/catch + Pino log on failure (`routine_sweep_failed`).

**Quiet hours helper** — extract from `routes/placeSubscriptions.js` or `geofence.js` into a shared `server/src/quietHours.js`:
- `export function inQuietHours(startMin, endMin, nowLocalMin)` — handles midnight wrap. If helper already exists, just import.

**Tests** (`server/test/routines.test.js` continued):
- Seed routine: school arrival at minute 495 (8:15), tolerance 15. created_at = 8 days ago (past observation period).
- At simulated `now` = today 9:00 local, no visit recorded → `evaluateRoutineSweep` inserts one `missed_arrival` alert, publishes WS event.
- Run again 30 min later → no duplicate (UNIQUE constraint).
- Seed visit at 8:20 → `evaluateRoutineSweep` does not fire (within tolerance).
- Subject paused → no fire.
- `routines_enabled = 0` → no fire.

### G2 acceptance
- `routine_deviation` event arrives on circle WS connection with correct shape.
- FCM push delivered to other circle members (verify with `fanOut` mock or with FCM disabled via log inspection).
- Same routine cannot fire twice in same day.
- Subject pause / disable kills the alert.

**Pause for human verification.**

---

## G3 — Routines management UI

**Server** — `server/src/routes/routines.js` (new):

| Method | Path | ACL | Description |
|---|---|---|---|
| GET | `/api/users/:userId/routines` | shared circle, log view audit (resource='routines') | List active+inactive routines for subject, joined to `places.name` |
| PATCH | `/api/routines/:id` | subject only OR circle admin | Body: `{active?, toleranceMinutes?, expectedMinute?}`. Editing expectedMinute flips `source` to 'manual' (auto-mine won't overwrite). |
| DELETE | `/api/routines/:id` | subject only OR circle admin | Soft delete (`active=0, source='manual'` so it stays deactivated). |
| GET | `/api/users/me/routine-prefs` | self | Returns `{routinesEnabled, quietStart, quietEnd}` from alert_prefs. |
| PATCH | `/api/users/me/routine-prefs` | self | Updates the same. |

Register in `index.js`. Rate-limit PATCH at 60/min.

**Android** (`android/app/src/main/java/com/familyguardian/`):
- `data/Models.kt`: `Routine`, `RoutineAlert`, `RoutinePrefs` DTOs with `@Serializable`.
- `data/RoutinesRepo.kt` (new): `listForMember(userId)`, `update(id, body)`, `delete(id)`, `getPrefs()`, `setPrefs(body)`.
- `events/GuardianEvent.kt`: add `data class RoutineDeviation(...) : GuardianEvent` with `@SerialName("routine_deviation")`.
- `events/Alerts.kt`: new `showRoutineDeviation(userId, displayName, placeName, kind, expectedMinute)`, base notif id 6_000_000. Use `CHANNEL_NORMAL` (not HIGH — it's informational, not emergency).
- `ui/RoutinesScreen.kt` (new): list per-member routines. When viewing your own profile: full management; when viewing another member: read-only with copy "Family Guardian noticed X usually arrives Y".
- `ui/AccountScreen.kt`: add "Smart routines" toggle + quiet-hours pickers, wired to routine-prefs endpoint.
- `MainActivity.kt`: route `RoutineDeviation` event into Alerts.kt.

**iOS** (`ios-app/App.tsx`):
- Extend type unions with `Routine`, `RoutineAlert`.
- New "Routines" screen pushed from MoreTab → "Smart routines" row.
- WS handler: process `routine_deviation`, post `Notifications.scheduleNotificationAsync` if app backgrounded.
- Account settings: toggle for routines_enabled + quiet hours pickers.

**PWA** (`server/src/public/` + `server/src/views/`):
- `views/settings.html` + `public/settings.js`: new "Smart routines" section showing the user's own routines table with toggle + delete + tolerance slider. Routine-prefs toggle and quiet-hours picker.
- `views/member.html` + `public/member.js`: new "Routines we've noticed" section, read-only when viewing another member.
- `public/app.js`: handle `routine_deviation` WS event (toast on dashboard).

### G3 acceptance
- Owner can see all their routines on the settings page; can disable/edit any.
- Other member can see the owner's routines on member.html (read-only).
- PATCH `expectedMinute=540` flips `source` to manual; next nightly mine doesn't overwrite.
- DELETE sets `active=0`; routine vanishes from active lists.

**Pause for human verification.**

---

## G4 — "Expected arrivals" widget

**Server** — extend `routes/routines.js`:
- `GET /api/circles/:circleId/expected-arrivals?within=240` — returns upcoming routine instances in the next N minutes (cap 24h). Filtered by circle membership. Each row: `{userId, displayName, photoUrl, placeId, placeName, kind, expectedMinute, expectedAt}` where `expectedAt` is the next epoch-ms occurrence given the user's local timezone estimate.

**Logic** (in `routines.js`):
- `export function getUpcomingRoutines(db, circleId, withinMinutes, now = Date.now())` — for each active routine in the circle, compute next occurrence within window. Skip if user paused.

**Android** (`MapScreen.kt`):
- A horizontal scrollable strip above the member list: `Sarah · Home · 4:00 PM (in 25 min)` cards. Tap a card → opens member detail.
- Refresh on `routine_deviation`, `location_update` (debounced), and every 5 min.

**iOS** (`App.tsx` MapTab):
- Same — horizontal `FlatList` above map: chips with member avatar + place name + expected time.

**PWA** (`public/app.js` dashboard):
- A small "Coming up" bar above the sidebar member list. Updates on WS events + every 5 min.

### G4 acceptance
- With 3 active routines, GET returns next 240 minutes of expected arrivals/departures, ordered by `expectedAt`.
- UI updates without page refresh after a routine_deviation event (the alert chip turns red).

**Pause for human verification.**

---

## G5 — Manual routine creation

**Server** — extend `routes/routines.js`:
- `POST /api/users/me/routines` — body `{placeId, kind, daysOfWeek: [0-6], expectedMinute: 0-1439, toleranceMinutes: 5-180}`. Creates one routine per day-of-week (multiple rows on one POST). `source = 'manual'`, `confidence = 1`, `sample_count = 0`, `created_at = now` (which BYPASSES the 7-day observation gate — manual routines fire on day 1; document this in the API table).
- Rate-limit 20/hour.

**Clients**:
- All three (Android RoutinesScreen, iOS Routines screen, PWA settings) get a "+ Add routine" button → small form (place picker from existing places, time picker, day-of-week chips, tolerance slider). All reuse existing form patterns from PlacesScreen.

### G5 acceptance
- POST with valid body creates N rows in routines (one per day-of-week).
- Routine fires `missed_arrival` next day if subject doesn't visit the place.
- Manual routines persist through nightly mine (not overwritten).

**Pause for human verification.**

---

## Files — created

```
server/src/migrations/021_routines.sql
server/src/migrations/022_alert_prefs_routines.sql
server/src/migrations/023_routine_alerts.sql
server/src/routines.js                     <- mining + sweeping + upcoming logic
server/src/routes/routines.js              <- all 8 endpoints
server/src/quietHours.js                   <- extracted helper (only if not already shared)
server/test/routines.test.js               <- vitest, in-memory SQLite, ~12 tests
android/app/src/main/java/com/familyguardian/data/RoutinesRepo.kt
android/app/src/main/java/com/familyguardian/ui/RoutinesScreen.kt
```

## Files — modified

```
server/src/index.js                        <- register routines route
server/src/scheduler.js                    <- nightly mine tick + 60s deviation sweep
server/src/routes/alertPrefs.js            <- expose routines_enabled, quiet hours
server/src/routes/profile.js               <- include routine prefs in /me response
server/src/routes/web.js                   <- pass routines/upcoming to dashboard initial state
server/src/public/app.js                   <- expected-arrivals strip + routine_deviation WS
server/src/public/settings.js              <- routines list + prefs UI
server/src/public/member.js                <- routines section on member page
server/src/views/settings.html             <- new "Smart routines" section
server/src/views/member.html               <- new "Routines we've noticed" section
android/app/src/main/java/com/familyguardian/data/Models.kt           <- DTOs
android/app/src/main/java/com/familyguardian/events/GuardianEvent.kt  <- RoutineDeviation
android/app/src/main/java/com/familyguardian/events/Alerts.kt         <- showRoutineDeviation
android/app/src/main/java/com/familyguardian/ui/MapScreen.kt          <- expected-arrivals strip
android/app/src/main/java/com/familyguardian/ui/AccountScreen.kt      <- routine prefs toggle
android/app/src/main/java/com/familyguardian/ui/MemberDetailScreen.kt <- routines section
android/app/src/main/java/com/familyguardian/MainActivity.kt          <- WS routing
ios-app/App.tsx                            <- types, screens, WS handler, prefs
README.md                                  <- Smart Routines feature section + API table
AGENTS.md                                  <- new tables + WS event
```

## Reused (no edit, just import)

- `publish()` from `hub.js` and `fanOut()` from `fcm.js` — same pattern as `alerts.js`.
- `logView()` from `audit.js` — for `GET /api/users/:userId/routines`.
- Quiet-hours helper from `placeSubscriptions.js` (extract to shared module if duplicating).
- `estimateLocalOffsetMinutes(lng)` from `drivingScore.js` — same lng-based UTC-offset estimate for local time.
- `requireCircleMembership` ACL pattern from `routes/visits.js` / `routes/trips.js`.
- `recordAlert` pattern from `alerts.js` — `routine_alerts` mirrors `alert_events` shape.
- Android `Alerts.kt` notification-channel pattern (use `CHANNEL_NORMAL` like check-ins, not HIGH).
- iOS `Notifications.scheduleNotificationAsync` (already wired for SOS / geofence).
- PWA `Avatar` helper in `public/app.js` (`avatarInner(m)`) — reuse for upcoming-arrivals chips.

---

## Recommended execution order

1. **Server schema + routines.js + tests** — migrations, mining logic, sweep logic, unit tests. Syntax-check, then `npm test`.
2. **Server scheduler wiring** — add nightly and 60s ticks. Smoke-test on live server via the `DATABASE_PATH=…/test.db PORT=8765 npm start` workflow in HANDOFF.md.
3. **Server routes/routines.js + index.js register** — curl-test each endpoint (list / patch / delete / prefs / manual create / upcoming).
4. **PWA — settings + member page + dashboard strip** — smallest client surface for fastest visual confirmation.
5. **Android — RoutinesScreen + Map strip + AccountScreen toggle + WS handler**.
6. **iOS — types + screens + WS handler + prefs**.
7. **README + AGENTS.md updates**.

Pause for human verification after steps 2, 3, 4, and 6.

---

## Verification (end-to-end)

```bash
# Boot clean test server
cd "h:/family-guardian/server"
rm -rf data/test.db* data/uploads tmp-test 2>/dev/null
DATABASE_PATH="$(pwd)/data/test.db" PORT=8765 npm start
until curl -sf http://127.0.0.1:8765/healthz >/dev/null 2>&1; do sleep 1; done; echo READY

# Bootstrap signup, get TOKEN (per HANDOFF.md snippet)
# Create a place "School" via POST /api/circles/:id/places

# G1 — seed visits + force mine
node -e "
const Database = require('h:/family-guardian/server/node_modules/better-sqlite3');
const db = new Database('h:/family-guardian/server/data/test.db');
const now = Date.now();
// 5 weekday-morning visits at 8:15 ± 5 min over 5 weeks (place_id=1, user_id=1, circle_id=1):
for (let w = 0; w < 5; w++) {
  const visitTime = now - (w * 7 + 1) * 86400_000;  // last Monday * 5
  const jitter = (Math.random() - 0.5) * 10 * 60_000;
  db.prepare('INSERT INTO visits (user_id, circle_id, place_id, lat, lng, started_at, ended_at, point_count) VALUES (1, 1, 1, 0, 0, ?, ?, 5)')
    .run(visitTime + jitter, visitTime + jitter + 30 * 60_000);
}
"
# Trigger mine via debug endpoint OR wait for nightly OR restart server (boot-time mine).
# Verify: SELECT * FROM routines; → one row with expected_minute ≈ 495, confidence > 0.7.

# G2 — simulate deviation
# Backdate routine.created_at to 8 days ago so observation period passes.
# At simulated time = today 9:00 (expected + tolerance + buffer), call evaluateRoutineSweep.
# Verify: routine_alerts row inserted, WS event arrived (use ws snippet from HANDOFF.md).

# G3 — list + toggle
TOKEN=...
curl -sH "Authorization: Bearer $TOKEN" http://127.0.0.1:8765/api/users/1/routines | jq .
curl -sX PATCH http://127.0.0.1:8765/api/routines/1 -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"active":false}'

# G4 — upcoming
curl -sH "Authorization: Bearer $TOKEN" "http://127.0.0.1:8765/api/circles/1/expected-arrivals?within=240" | jq .

# G5 — manual creation
curl -sX POST http://127.0.0.1:8765/api/users/me/routines \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"placeId":1,"kind":"arrival","daysOfWeek":[1,2,3,4,5],"expectedMinute":495,"toleranceMinutes":15}'

# Clean up
PID=$(netstat -ano | grep :8765 | grep LISTENING | head -1 | awk '{print $5}')
if [ -n "$PID" ]; then taskkill //F //PID $PID; fi
rm -rf data/test.db* data/uploads tmp-test
```

**UI smoke** (one rep each):
- PWA: log in as Alice (Chrome) and Bob (Firefox). Backdate a routine in Alice's DB. Force a missed arrival → Bob sees toast + alert chip in expected-arrivals strip.
- Android: same scenario, verify system notification arrives via `Alerts.showRoutineDeviation`.
- iOS (Expo Go): same scenario, verify in-app banner + push.

---

## Risks & pause points

| Risk | Mitigation |
|---|---|
| False-positive storm in week 1 | 7-day observation gate before any routine fires (decision #4). |
| Timezone drift (DST, traveling) | lng-based local-tz estimate from `drivingScore.js`. Reuse, don't reinvent. Accept ±1 hour edge cases. |
| Privacy backlash ("you're tracking my schedule") | Transparent settings page lists every learned routine. Per-routine + global toggles. Quiet hours. Default OFF for new circles (decision change pending — see open question below). |
| Nightly mine cost grows with `visits` rows | 30-day window keeps it bounded. Index on `visits(user_id, place_id, started_at)` (already exists). Re-measure when `visits` exceeds 100k rows. |
| Scheduler tick drift | Use `setTimeout` with next-fire-time computation rather than `setInterval` for the nightly job. |
| Cross-platform notification routing | Reuse the existing `Alerts.kt` / `Notifications.scheduleNotificationAsync` / browser-Notification paths — don't introduce new channels. |

---

## Open questions (resolve before starting)

1. **Default ON or OFF for new users?** Plan currently says ON (decision #8) for opt-out simplicity, but privacy framing argues for OFF-with-prompt during onboarding. Pick the tone.
2. **Manual routines bypass observation window** — confirm OK (plan says yes, document in API).
3. **Should circle admins be able to edit other members' routines?** Plan currently says yes; could restrict to subject-only.

These don't block implementation start — they can be settled during G1 / G3 work.

---

## House rules carryover (locked-in by `NEXT_SPRINT_PROMPT.md`)

- One focused theme per sprint. Don't add features beyond scope. Don't over-engineer.
- TaskCreate/TaskUpdate for multi-step work. One task `in_progress` at a time.
- Test on a live server before claiming a sub-feature done.
- Pause for human verification after each sub-feature.
- No commits without ask. No pushes, ever.
- ESM `.js` extensions on local imports. Synchronous `db.transaction(() => {})()`. Pino structured logs.
- Raw-replace before safe-replace in `routes/web.js` template render. Don't reorder.
