# Family Guardian — Sprint 6 Plan: Insights & Visibility

> Paste this whole file into a fresh Claude Code session at `h:\family-guardian` and tell the agent: **"Pick up the Family Guardian work — read SPRINT_6_PLAN.md and continue with H1. Read HANDOFF.md first for repo conventions."**

## Context

**Why this sprint.** Five sprints have shipped — privacy, smart notifications, chat polish, driving safety, smart routines. Each one *added* signal. None of them put that signal in front of the user in a single glance. Today, opening Family Guardian shows a map and a sidebar. The trips, visits, routines, driving scores, alerts, and check-ins the platform has been collecting are scattered across separate tabs, and `GET /api/users/:userId/driving-score` has no client UI on any of the three surfaces. Sprint 6 turns the existing data into the product. No new sensors. No new privacy surface area. Just visibility.

**House-rules carryover** (locked-in by `NEXT_SPRINT_PROMPT.md` and `SPRINT_5_PLAN.md`):
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
| 5 | Smart Routines & Deviation | **Shipped** |
| **6** | **Insights & Visibility** | **This sprint** |

---

## Sprint 6 sub-features

Five sub-features, executed in order. Each has server + client work and a verification gate.

| Sub | Title | Server effort | Client effort |
|---|---|---|---|
| H1 | Family **Health widget** (one-row status per member) | Small | Medium |
| H2 | Unified **Activity Timeline** on member page | Medium | Medium |
| H3 | **Driving Score** UI on all three clients | None (endpoint exists) | Medium |
| H4 | Per-place **geofence analytics** | Small | Small |
| H5 | Weekly **Family Digest** (nightly aggregate + UI + push) | Medium | Small |

---

### Design decisions (locked-in before implementation)

These prevent the plan from drifting during execution. Confirm before starting:

1. **No new tracking signals.** Every sub-feature derives from existing tables (`locations`, `locations_history`, `visits`, `trips`, `trip_events`, `check_ins`, `routines`, `alert_events`). Only one new table: `digest_snapshots` for H5.
2. **Health widget is read-only.** Tapping a pill opens the member detail page; no inline actions. Source of truth = `GET /api/circles/:id/health` returning the same data the dashboard already needs, just consolidated.
3. **Activity timeline is server-merged.** Don't ship three separate fetches and let the client interleave — that pushes O(N) row joins to the slowest device. New `/api/circles/:circleId/members/:userId/timeline?days=&before=&limit=` returns a unified, sorted feed. Each row carries a `kind` (`visit_started`, `visit_ended`, `trip_started`, `trip_ended`, `check_in`, `routine_deviation`, `alert`) and a `payload` blob.
4. **Driving Score is per-member, not per-circle.** Show on member detail page (all three surfaces) and as a small score chip on the dashboard sidebar avatar (PWA + Android only — iOS map markers don't support overlays well). Endpoint already exists — `GET /api/users/:userId/driving-score?days=7`. **Reuse, don't re-derive.**
5. **Geofence analytics is per-place.** Surfaced as an analytics tab on the place detail modal (PWA `places.html`, Android `PlacesScreen.kt`, iOS Places tab). Aggregates the last 30 days of `visits` for that place.
6. **Weekly digest fires Sunday 18:00 server-local.** Caps at one push per user per week. Default OFF for new users; user opts in from Settings. The PWA "This week" card is **always visible** regardless of push pref — push is the escalation channel, the card is the always-on summary.
7. **Digest data window** = last 7 calendar days (Mon–Sun in user-local tz, longitude-estimated). Same `estimateLocalOffsetMinutes(lng)` helper from `drivingScore.js` — reuse.
8. **Privacy-respecting.** All endpoints reuse `requireAuth` + circle-membership ACL + `logView()` from `audit.js` where they read another member's data. Paused users render with a `⏸` badge but their pre-pause snapshot is still summarized — the user opted into history visibility, not just live tracking.
9. **No new WS events** for H1–H4. The widget refreshes on `location_update`, `check_in`, `pause_changed`, `routine_deviation`, `sos_active`, `sos_resolved` (all already broadcast). H5 adds one new event `digest_ready` and reuses existing `fanOut()` for push.
10. **Mobile-PWA parity is in scope; iOS/Android parity is best-effort.** The two native apps already lag on a few UI details (e.g., osmdroid markers stay as initials per HANDOFF.md). This sprint does not unblock those — it ships what the existing surface can absorb without touching the marker rendering layer.

---

## H1 — Family Health widget

**Server**

New endpoint in `server/src/routes/locations.js` (no new file — same domain as the existing member-roster query):

```
GET /api/circles/:id/health
→ { members: [
    {
      userId, displayName, photoUrl,
      batteryPct, batteryUpdatedAt,
      lastFixAt, staleMinutes,
      activity, paused, pausedUntil,
      nextRoutine: { kind, placeName, expectedAt } | null,
      drivingScore: number | null,   // last-7d score, cached <5min
      checkinStatus: string | null, checkinAt: number | null
    }, …
  ]}
```

Implementation:
- Single SQL with LEFT JOINs across `users`, `locations`, `routines` (next active routine for today), `check_ins` (latest), `alert_prefs`. No N+1.
- Driving score is **per-member-cached in memory** for 5 minutes (Map keyed on `userId`, refreshed in-line when stale). Computing for 10 members on every dashboard load would be wasteful; the score only meaningfully changes on trip close.
- Membership ACL via existing `assertMember` pattern.
- `logView(db, viewerId, subjectId, 'member_page')` is **not** fired here — health is a sidebar widget, not a deep dive. Otherwise every dashboard load floods the audit log.

**PWA** (smallest surface — start here for fast visual confirmation)
- `server/src/public/app.js`: render a horizontal strip above the existing members sidebar. Each pill = avatar + battery icon + small dot (green = online <5min, amber 5–30min, red >30min, gray = paused). Click → opens `/member/:userId`.
- Re-fetch on WS events listed in design decision #9 (debounced 1s).
- On `dashboard.html` desktop, the strip sits between the page header and the map. On `app-mobile/app.html`, it's a horizontal scroll card row above the bottom tab bar map view.

**Android**
- `data/HealthRepo.kt` (new): `suspend fun fetch(circleId): List<MemberHealth>`.
- `data/Models.kt`: `MemberHealth` DTO mirroring the JSON above.
- `ui/MapScreen.kt`: above the existing expected-arrivals strip (from Sprint 5), add a `LazyRow` of `HealthPill` composables. Reuse `Avatar.kt` for the headshot + pause overlay; battery + dot are simple Material `Icon` + `Surface`.
- Refresh on the WS events listed above (already routed through `MainActivity.kt` → `EventBus`).

**iOS** (`ios-app/App.tsx`)
- New `MemberHealth` type alongside existing `Member`.
- New `<HealthStrip>` component rendered above the map on Map tab.
- WS handler additions in the existing `useEffect` that already routes `location_update` etc.

### H1 acceptance
- Open PWA dashboard → strip renders with one pill per member; offline member shows red dot.
- Pause a member from Settings → their pill goes gray with `⏸` overlay within 2s (no refresh).
- Send a check-in from Android → pill on PWA updates `checkinStatus` within 2s.
- DB query plan check (`EXPLAIN QUERY PLAN` on the health SQL): no full scans on `locations_history` or `visits`.

**Pause for human verification.**

---

## H2 — Unified Activity Timeline

**Server**

New endpoint in a new file `server/src/routes/timeline.js`:

```
GET /api/circles/:circleId/members/:userId/timeline?days=7&before=<ms>&limit=100
→ { items: [
    { kind: 'visit_started' | 'visit_ended' | 'trip_started' | 'trip_ended' |
            'check_in' | 'routine_deviation' | 'alert',
      at: <ms>,
      payload: { … kind-specific … } }, …
  ], cursor: <ms or null> }
```

Implementation:
- `days` ∈ [1, 30], default 7. `limit` ∈ [10, 200], default 100.
- Build via `UNION ALL` across `visits` (started + ended as two rows when both present), `trips` (started + ended), `check_ins`, `routine_alerts`, `alert_events`. ORDER BY at_ms DESC LIMIT N.
- `payload` is built per-row with whatever the existing visits/trips routes already return (reuse `visitRowToJson` and `tripRowToJson` shapes — extract from `visits.js` / `trips.js` into a shared `server/src/payloads.js` helper).
- Membership ACL + `logView(viewerId, subjectId, 'history')` (reuse existing resource type — it's the same conceptual access).
- Existing `audit.js` `VALID_RESOURCES` set already includes `'history'`; no schema change.

Register in `index.js`. Rate-limit 60/min.

**Tests** (`server/test/timeline.test.js`):
- Seed a member with 2 visits, 1 trip, 1 check-in, 1 routine alert; query → all 6 items (visit creates 2 rows) in correct order.
- `before` cursor returns the next page correctly.
- ACL: non-member gets 403; subject gets 200 viewing self (no logView fired).

**PWA** (`server/src/views/member.html` + `server/src/public/member.js`):
- Replace the three existing tabs (history / visits / trips) with **one** "Timeline" tab as the default landing tab. Keep the existing tabs for the map polyline view (still useful for the actual GPS path); rename them to "Path" / "Visits" / "Trips" for advanced users.
- Timeline renders a card per item, color-coded by `kind`. Day-header separators (Today / Yesterday / "May 17"). Reuse `units.js` formatters.

**Android** (`ui/MemberDetailScreen.kt`):
- Add a new top tab "Timeline" (Material `TabRow`). The existing Path/Visits/Trips/etc. stay below. Use `RoutinesRepo.kt`'s `itemsWithDayHeaders` pattern (already established from `ChatScreen.kt`).
- `data/TimelineRepo.kt` (new) mirrors the existing `VisitsRepo.kt`.
- `data/Models.kt`: `TimelineItem` sealed class with per-kind data classes.

**iOS** (`App.tsx`):
- Member detail screen gets a "Timeline" section above the existing visits/trips listing.
- Simple `FlatList` with sectioned headers.

### H2 acceptance
- API: `curl …/timeline?days=3 | jq '.items | length'` returns expected count for a seeded member.
- PWA: opening member.html lands on Timeline tab; renders in correct order; day headers correct in local tz.
- Android: Timeline tab on MemberDetail renders without crashing; tap on a trip item opens existing trip detail.

**Pause for human verification.**

---

## H3 — Driving Score UI

**No server changes.** `GET /api/users/:userId/driving-score?days=7` already exists in `server/src/routes/drivingScore.js`, returns `{ score, days, tripCount, drivingMs, distanceM, hardBrakeCount, hardBrakePer100Km, speedingMinutes, speedingThresholdMps, nightMiles, nightDrivingPct }`.

**PWA** (`server/src/public/member.js` + `views/member.html`):
- "Driving" card on member detail page: big score (color-coded green/yellow/red), small stats below (`X hard brakes in 7d`, `Y min over speed limit`, `Z km night`).
- Range selector `7d / 30d / 90d` (driving score endpoint accepts `?days=`).
- Sidebar avatar in `app.js`: small score chip overlay (e.g., bottom-right of avatar) for any member whose `drivingScore` came back non-null from H1's `/health` endpoint.

**Android** (`ui/MemberDetailScreen.kt`):
- New "Driving" section. Reuse `data/RoutinesRepo.kt` pattern in a new `data/DrivingScoreRepo.kt`.
- Map-screen members dialog: append `· Score: 87` after display name when known.

**iOS** (`App.tsx`):
- Member detail screen: "Driving safety" section identical in shape to PWA.

### H3 acceptance
- Member with no driving trips → "No driving in selected range" (score `null`).
- Member with seeded trips + 2 hard brakes → score < 100, breakdown matches `computeDrivingScore` formula.
- Range toggle re-fetches and re-renders.

**Pause for human verification.**

---

## H4 — Geofence visit analytics

**Server**

New endpoint in `server/src/routes/places.js` (extend, don't add new file):

```
GET /api/places/:id/analytics?days=30
→ {
    placeId, placeName,
    days,
    perMember: [
      { userId, displayName, visitCount, totalDwellMs, lastVisitAt,
        avgDwellMs, longestDwellMs }, …
    ],
    weekOverWeek: { lastWeekCount, prevWeekCount, deltaPct }
  }
```

Implementation:
- ACL: caller must be in the same circle as the place.
- Single SQL grouping `visits` by `user_id` where `place_id = ? AND started_at >= ?`.
- Week-over-week: two date-bucketed counts.

**Tests** (`server/test/places_analytics.test.js`):
- Seed 5 visits across 2 users → analytics returns 2 perMember rows with correct counts.
- `days` clamped to [1, 90].

**PWA** (`places.html` + `places.js`):
- Add "Analytics" tab to existing place detail modal. Render bar chart (Chart.js? — **no**, avoid new dep. Use the existing simple HTML/CSS bars pattern from `member.html`).

**Android** (`ui/PlacesScreen.kt`):
- Long-press a place → bottom sheet with "Edit" + "Subscriptions" (existing) + new "Analytics" option.
- Analytics opens a sub-screen `ui/PlaceAnalyticsScreen.kt` (new) with a `LazyColumn` of per-member rows.

**iOS** (`App.tsx`):
- Tap a place card → existing edit sheet, add an "Analytics" footer button → push a new screen with the same data.

### H4 acceptance
- Seed visits for 3 users at one place → endpoint returns 3 perMember rows.
- PWA modal renders without overflow on mobile width 320px.

**Pause for human verification.**

---

## H5 — Weekly Family Digest

**Server**

Migration `server/src/migrations/024_digest_snapshots.sql`:
```sql
CREATE TABLE IF NOT EXISTS digest_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id     INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    week_start    INTEGER NOT NULL,     -- ms epoch, local-Monday midnight
    week_end      INTEGER NOT NULL,
    summary_json  TEXT    NOT NULL,     -- structured snapshot per member
    created_at    INTEGER NOT NULL,
    UNIQUE (circle_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_digest_circle ON digest_snapshots(circle_id, week_start DESC);

ALTER TABLE alert_prefs ADD COLUMN weekly_digest_enabled INTEGER NOT NULL DEFAULT 0;
```

New module `server/src/digest.js`:
- `export function buildDigest(db, circleId, weekStartMs, weekEndMs)` — pure aggregation:
  - Per member: trips count + total km + max speed; visits count + top 3 places by dwell; routine adherence (count of fires vs misses); driving score (reuse `computeDrivingScore`); check-in count.
  - Circle: total km driven, total alerts, busiest place, "quietest" member.
  - Returns a JSON-serializable object.
- `export function persistDigest(db, circleId, weekStartMs, weekEndMs, summary)` — INSERT OR REPLACE into `digest_snapshots`.
- Pure functions, take `now` as param for testability.

New route in `server/src/routes/profile.js` (extend, since it already hosts prefs):
- `GET /api/circles/:circleId/digest/current` — returns latest snapshot for the circle (membership ACL).
- `GET /api/circles/:circleId/digest?since=<ms>` — list snapshots since timestamp (default last 12 weeks).
- `PATCH /api/users/me/digest-prefs` body `{ enabled: boolean }` — toggle push delivery.

Scheduler wiring in `server/src/scheduler.js`:
- Add `weeklyDigestTick(db, log)` that runs once per minute, computes "is it Sunday 18:00 server-local right now (±60s window)", and if so:
  1. For each circle with active members:
     - Compute `weekStart` = previous Monday 00:00 local; `weekEnd` = this Sunday 23:59 local.
     - Skip if a snapshot for `(circle_id, weekStart)` already exists (idempotency on restart).
     - `persistDigest(buildDigest(…))`.
     - `publish(circleId, { type: 'digest_ready', weekStart, weekEnd })` — new WS event, lightweight.
     - For each member with `weekly_digest_enabled = 1`: `fanOut(circleId, …)` with a single push payload pointing at `/dashboard#digest`.
- Use the existing setTimeout-with-next-fire-time pattern from the routine miner (`scheduleNextMine` in `scheduler.js`) — don't use setInterval for the daily/weekly job to avoid drift.
- Add a `digest_snapshots` cleanup line to the existing `cleanupTick` retention sweep (12-week window).

**Tests** (`server/test/digest.test.js`):
- Seed a 7-day window with trips, visits, alerts → `buildDigest` returns expected per-member counts.
- `persistDigest` honors UNIQUE constraint (running twice is a no-op).
- Scheduler tick: time-travel to Sunday 18:00:30 → snapshot inserted; next tick at 18:01:30 → no duplicate.

**PWA** (`views/dashboard.html` + `public/app.js`):
- "This week" card at top of sidebar (or under H1 health strip): renders the most recent snapshot. Each member gets a one-line summary; tap → modal with full details.
- "Get weekly digest" toggle on `settings.html`.
- New WS event `digest_ready` triggers a soft refresh of the card (no toast — it's a passive widget).

**Android**
- `data/DigestRepo.kt` (new): `getCurrent(circleId)`, `setEnabled(boolean)`.
- `ui/MapScreen.kt`: above (or inside) the existing expected-arrivals strip, add a "Weekly digest" card when a current snapshot exists. Tap → `ui/DigestScreen.kt` (new) showing the full summary.
- `ui/AccountScreen.kt`: digest toggle row.
- `events/GuardianEvent.kt`: `DigestReady` variant; `Alerts.kt` `showDigest()` (only fired by FCM push from server, not by WS — keep `CHANNEL_NORMAL`, low importance).

**iOS** (`App.tsx`):
- "Weekly digest" toggle in More tab.
- "This week" section in Map tab (above the map) when a snapshot is available.

### H5 acceptance
- Seed a 7-day window with mixed activity → wait for / force-run the Sunday tick → snapshot row exists.
- `weekly_digest_enabled = 1` → FCM push delivered (or "FCM disabled" logged if env unset).
- PWA "This week" card renders; toggling pref off prevents push but card stays visible.

**Pause for human verification.**

---

## Files — created

```
server/src/migrations/024_digest_snapshots.sql
server/src/routes/timeline.js                <- H2 merged feed endpoint
server/src/payloads.js                       <- shared visit/trip/checkin row→JSON helpers (extract from visits.js + trips.js)
server/src/digest.js                         <- H5 aggregator + persistence
server/test/timeline.test.js                 <- H2 unit tests
server/test/places_analytics.test.js         <- H4 unit tests
server/test/digest.test.js                   <- H5 unit tests
server/test/health.test.js                   <- H1 unit tests (route + cache behavior)
android/app/src/main/java/com/familyguardian/data/HealthRepo.kt
android/app/src/main/java/com/familyguardian/data/TimelineRepo.kt
android/app/src/main/java/com/familyguardian/data/DrivingScoreRepo.kt
android/app/src/main/java/com/familyguardian/data/DigestRepo.kt
android/app/src/main/java/com/familyguardian/ui/PlaceAnalyticsScreen.kt
android/app/src/main/java/com/familyguardian/ui/DigestScreen.kt
```

## Files — modified

```
server/src/routes/locations.js        <- H1 /api/circles/:id/health endpoint
server/src/routes/places.js           <- H4 /api/places/:id/analytics endpoint
server/src/routes/profile.js          <- H5 digest prefs + GET endpoints
server/src/routes/visits.js           <- import row→JSON from payloads.js
server/src/routes/trips.js            <- import row→JSON from payloads.js
server/src/index.js                   <- register timeline route
server/src/scheduler.js               <- weeklyDigestTick + digest retention cleanup
server/src/public/app.js              <- H1 health strip + H5 "this week" card + WS handlers
server/src/public/member.js           <- H2 timeline tab + H3 driving score card
server/src/public/places.js           <- H4 analytics tab
server/src/public/settings.js         <- H5 digest toggle
server/src/views/dashboard.html       <- H1 + H5 widgets
server/src/views/member.html          <- H2 + H3 sections
server/src/views/places.html          <- H4 tab
server/src/views/settings.html        <- H5 toggle
server/src/views/app.html             <- H1 + H5 widgets in mobile PWA shell
server/src/public/app-mobile/app.js   <- H1 horizontal strip + H5 card in mobile PWA
android/app/src/main/java/com/familyguardian/data/Models.kt           <- DTOs
android/app/src/main/java/com/familyguardian/ui/MapScreen.kt          <- H1 strip + H5 card
android/app/src/main/java/com/familyguardian/ui/MemberDetailScreen.kt <- H2 + H3 sections
android/app/src/main/java/com/familyguardian/ui/PlacesScreen.kt       <- H4 long-press analytics
android/app/src/main/java/com/familyguardian/ui/AccountScreen.kt      <- H5 toggle
android/app/src/main/java/com/familyguardian/events/GuardianEvent.kt  <- DigestReady
android/app/src/main/java/com/familyguardian/events/Alerts.kt         <- showDigest
android/app/src/main/java/com/familyguardian/MainActivity.kt          <- WS routing
ios-app/App.tsx                                                       <- H1 strip + H2 timeline + H3 score + H4 analytics + H5 digest toggle/card
README.md                                                             <- Insights section + API table updates
AGENTS.md                                                             <- new table + WS event
```

## Reused (no edit, just import)

- `publish()` from `hub.js` and `fanOut()` from `fcm.js` — same pattern as `alerts.js`, `routines.js`.
- `logView()` from `audit.js` — for H2 timeline and H3 driving score views (`'history'` and `'driving_score'` resources already valid).
- `estimateLocalOffsetMinutes(lng)` (or its equivalent in `drivingScore.js`) — same lng-based UTC-offset estimate for digest week boundaries.
- `assertMember`/`requireCircleMembership` ACL pattern from `routes/visits.js` / `routes/trips.js`.
- `computeDrivingScore` from `drivingScore.js` — reused in H1 (cached) and H5 (digest aggregation).
- PWA `Avatar` helper in `public/app.js` (`avatarInner(m)`) — for health strip pills.
- Android `Alerts.kt` notification-channel pattern (`CHANNEL_NORMAL` for digest push — informational, not emergency).

---

## Recommended execution order

1. **Server H1 + tests** — `routes/locations.js` health endpoint + `test/health.test.js`. Syntax-check, run `npm test`.
2. **PWA H1** — strip on dashboard.html. Smallest visual confirmation that the data flows.
3. **Android H1 + iOS H1** — port the strip.
4. **Server H2** — `routes/timeline.js` + `payloads.js` extraction + `test/timeline.test.js`. curl-verify.
5. **PWA H2** — Timeline tab on member.html.
6. **Android H2 + iOS H2** — port the timeline.
7. **H3 across all three clients** — no server work; concurrent PWA + Android + iOS UI.
8. **Server H4** — analytics endpoint + tests. curl-verify.
9. **H4 on all three clients** — analytics tab.
10. **Server H5** — migration + `digest.js` + scheduler tick + tests. Force-run a sunday tick via env override or by adjusting a temp clock.
11. **PWA H5** — "This week" card + settings toggle.
12. **Android H5 + iOS H5** — digest screen + toggle.
13. **README + AGENTS.md updates**.

Pause for human verification after steps 3, 6, 7, 9, and 12.

---

## Verification (end-to-end)

```bash
# Boot clean test server
cd "h:/family-guardian/server"
rm -rf data/test.db* data/uploads tmp-test 2>/dev/null
DATABASE_PATH="$(pwd)/data/test.db" PORT=8765 npm start
until curl -sf http://127.0.0.1:8765/healthz >/dev/null 2>&1; do sleep 1; done; echo READY

# Bootstrap signup, get TOKEN (per HANDOFF.md snippet)
# Create a place "School" + post several location fixes + a check-in

# H1 — health
curl -sH "Authorization: Bearer $TOKEN" http://127.0.0.1:8765/api/circles/1/health | jq .

# H2 — timeline
curl -sH "Authorization: Bearer $TOKEN" "http://127.0.0.1:8765/api/circles/1/members/1/timeline?days=7" | jq '.items | length'

# H3 — driving score (no new endpoint, sanity check existing one)
curl -sH "Authorization: Bearer $TOKEN" "http://127.0.0.1:8765/api/users/1/driving-score?days=30" | jq .

# H4 — place analytics
curl -sH "Authorization: Bearer $TOKEN" "http://127.0.0.1:8765/api/places/1/analytics?days=30" | jq .

# H5 — force a digest run via DB seed + restart, OR just verify the table:
node -e "
const Database = require('h:/family-guardian/server/node_modules/better-sqlite3');
const db = new Database('h:/family-guardian/server/data/test.db');
console.log(db.prepare('SELECT * FROM digest_snapshots').all());
"
curl -sH "Authorization: Bearer $TOKEN" "http://127.0.0.1:8765/api/circles/1/digest/current" | jq .

# Clean up (per HANDOFF.md)
PID=$(netstat -ano | grep :8765 | grep LISTENING | head -1 | awk '{print $5}')
if [ -n "$PID" ]; then taskkill //F //PID $PID; fi
rm -rf data/test.db* data/uploads tmp-test
```

**UI smoke** (one rep each):
- PWA: log in as Alice (Chrome) and Bob (Firefox). Watch Alice's health pill on Bob's dashboard update when Alice's device posts a fix or check-in.
- Android: open MemberDetail → confirm Timeline + Driving sections render.
- iOS (Expo Go): open a place on Places tab → confirm Analytics shows visit counts.
- Force a Sunday-18:00 digest tick (temp-adjust the scheduler clock or seed a snapshot directly) → confirm "This week" card renders on PWA dashboard.

---

## Risks & pause points

| Risk | Mitigation |
|---|---|
| Health endpoint becomes the dashboard's hot path | 5-min in-memory cache on driving score. EXPLAIN-QUERY-PLAN the SQL during dev; add covering indexes if needed (`locations(user_id)` already indexed). |
| Timeline `UNION ALL` query gets slow as `visits` / `trips` grow | 30-day window cap. Existing indexes on `(user_id, started_at)` cover the access pattern. Re-measure once any single table exceeds 50k rows. |
| Driving score computed per dashboard load = expensive | H1 caches it; H3 only computes on-demand from member page. |
| Digest scheduler drifts (DST) | Use setTimeout with next-fire-time recomputation, same as routine miner. Don't use setInterval. |
| Digest push storms (many circles fire simultaneously at 18:00) | Loop is sequential per-circle; FCM `fanOut` already batches. If self-hoster has ≥100 circles this matters; otherwise non-issue. |
| New `digest_snapshots` table grows unbounded | 12-week retention sweep added to the existing `cleanupTick` in `scheduler.js`. |
| Timeline merges may surface paused-member data to viewers | The pause feature was always about *live* location, not history. The audit log already covers "who viewed me". No new privacy surface here. |
| iOS App.tsx is one file and already large | Don't extract — that's a separate refactor. Add the new sections inline with the existing pattern. |

---

## Open questions (resolve before starting)

1. **Default digest pref: ON or OFF for new users?** Plan says OFF (decision #6, opt-in for push). Confirm — privacy lean argues OFF; engagement lean argues ON-with-prompt-during-onboarding.
2. **Where does the "This week" card sit on mobile?** Above the map (taking screen real estate) or behind a top-bar button? Recommend behind a button on mobile, above the map on desktop.
3. **Health endpoint cache: per-process or per-(circle, user)?** Per-(circle, user) Map keyed on `userId` — keeps the cache hot for the dashboard's most-frequent reads.

These don't block implementation start — they can be settled during H1 / H5 work.

---

## House rules carryover (locked-in by `NEXT_SPRINT_PROMPT.md` and prior sprint plans)

- One focused theme per sprint. Don't add features beyond scope. Don't over-engineer.
- TaskCreate/TaskUpdate for multi-step work. One task `in_progress` at a time.
- Test on a live server before claiming a sub-feature done.
- Pause for human verification after each sub-feature.
- No commits without ask. No pushes, ever.
- ESM `.js` extensions on local imports. Synchronous `db.transaction(() => {})()`. Pino structured logs.
- Raw-replace before safe-replace in `routes/web.js` template render. Don't reorder.

---

## Critical files to read first when implementing

- `server/src/routes/locations.js` — for H1 endpoint placement, member-roster SQL pattern.
- `server/src/routes/visits.js`, `routes/trips.js`, `routes/checkins.js` — for H2 payload shapes to merge.
- `server/src/drivingScore.js` — for H3 score breakdown understanding (computed shape is already correct; just render it).
- `server/src/routes/places.js` — for H4 endpoint placement.
- `server/src/scheduler.js` — for H5 setTimeout-with-next-fire-time pattern from `scheduleNextMine`.
- `server/src/routes/web.js` — template render order pitfall (raw before safe).
- `server/src/public/app.js` + `views/dashboard.html` — H1 + H5 render target.
- `server/src/public/member.js` + `views/member.html` — H2 + H3 render target.
- `android/app/src/main/java/com/familyguardian/ui/MapScreen.kt` — H1 + H5 strip target (already has Sprint 5 expected-arrivals strip).
- `android/app/src/main/java/com/familyguardian/ui/MemberDetailScreen.kt` — H2 + H3 section target.
- `ios-app/App.tsx` — single-file iOS app for all client surfaces.
- `SPRINT_5_PLAN.md` — voice/structure reference.
- `HANDOFF.md` — repo conventions; especially template render-order trap and ESM `.js` import rule.
