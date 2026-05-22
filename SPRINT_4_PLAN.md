# Sprint 4 — Driving Safety (A1–A2)

> **Final destination on approval:** copy this file to `h:\family-guardian\SPRINT_4_PLAN.md`, matching the repo's existing `SPRINT_N_PLAN.md` convention (siblings of `SPRINT_3_PLAN.md`, `NEXT_SPRINT_PROMPT.md`, `HANDOFF.md`). The plan-mode constraint requires the working copy to live at the path above; the rooted file is the deliverable the user asked for.

---

## Context

Family Guardian has shipped three sprints to date: privacy controls (Sprint 1), smart notifications + reactions (Sprint 2), and chat polish (Sprint 3 — voice/photo/typing/read-receipts). The roadmap in `NEXT_SPRINT_PROMPT.md` lines 30 + 281–284 designates **Driving Safety** as Sprint 4, and the user has confirmed full scope: both **A1 crash detection** (auto-SOS via on-device accelerometer) and **A2 driving score** (7-day safety score from trip data). The problem this sprint solves: the app already tracks trips (start/end, distance, max speed) but doesn't translate that data into a safety signal, and it has no protection against the worst-case driving outcome (a crash where the driver is incapacitated). A1 + A2 together turn the existing telemetry into a meaningful safety surface. Intended outcome: a circle member who opts into crash detection has an automatic 30-second-cancellable SOS path on impact, and any guardian can see a 7-day driving-safety score for circle members on the member detail page. Both features ride on infrastructure shipped in earlier sprints (existing `sos_events` table, `trips` aggregator, pass-through WebSocket hub).

Scope confirmed by maintainer: full A1 + A2 across all four surfaces (server, PWA, Android, iOS). Crash detection **opt-in by default** to mirror Sprint 3's read-receipts posture.

---

## Build order and ship gates

Strict order: **A2 → A1**. A2 ships first because it has no new sensor stack, no iOS Expo dependencies, and no full-screen UI — it's pure server-side math + read-only UI tiles, so it's a low-risk warm-up that exercises the trip schema we extend for A1. A1 ships second because (a) iOS sensor work touches the fragile Expo pod chain, (b) the 30-s countdown UI is the highest visual risk, and (c) it benefits from the `trip_events` granularity A2 introduces.

Pause for human verification at every checkpoint.

| Phase | Feature                       | Migration                     | New tests                                  |
|-------|-------------------------------|-------------------------------|--------------------------------------------|
| A2    | Driving safety score          | `019_trip_events.sql`         | `server/test/driving_score.test.js`        |
| A1    | Crash detection + auto-SOS    | `020_crash_events.sql`        | `server/test/crash_events.test.js`         |

Why two migrations and not one: A2 needs `trip_events`; A1 needs `crash_events` + an opt-in flag on `users`. The opt-in flag lives in A2's migration (additive column) so A1 only has to create one new table — but the *behavior* of crash detection is gated to A1. Splitting keeps A2 cleanly revertable if A1 sensor work stalls.

---

## Locked-in design decisions

1. **A2 first, A1 second.** Server-side math is lower risk than iOS Expo sensor work. A2 also surfaces whether `trips` has enough granularity (it doesn't — see #4) before A1 needs the same columns.
2. **Crash detection is opt-in by default.** New column `users.crash_detection_enabled INTEGER NOT NULL DEFAULT 0`. Mirror of Sprint 3's `read_receipts_enabled` pattern. Settings copy: "When on, Family Guardian uses your phone's motion sensor to detect possible crashes and alerts your circle if you don't dismiss the countdown."
3. **One source of truth for the active alert.** Reuse `sos_events` for the in-flight SOS. The new `crash_events` table is an audit/postmortem record that **links to** the `sos_events.id` it produced (FK on resolve, nullable on insert in case the user cancels the countdown — see #6).
4. **Trip granularity gap.** The existing `trips` table only stores summary aggregates (`distance_m`, `max_speed_mps`, `avg_speed_mps`). It has **no per-second samples**, so we cannot back-derive hard-brake counts or speeding-minutes from history. Solution: new `trip_events` table populated by `server/src/trips.js` from incoming location fixes during a live trip in mode=`driving`. Schema is small (one row per *event*, not per fix), so retention is cheap.
5. **Hard-brake from GPS speed deltas, not accelerometer.** Hard-brake events are detected server-side from the speed delta between consecutive fixes in a live trip. Threshold: Δv ≤ −3.5 m/s over Δt ≤ 6 s (≈ −0.58 m/s² average, conservative because GPS speed is noisy and our fix interval is 15–30 s on Android, 30 s on iOS). This avoids piggybacking on the A1 accelerometer stream (which only runs on opt-in devices in driving).
6. **`crash_events.sos_event_id` is nullable.** The row is inserted when the client reports a candidate (with or without countdown dismissal). If the user dismisses, `dismissed_at` is set and `sos_event_id` stays NULL. If 30 s elapses, the client calls `POST /api/sos/activate` with `source:"crash"` and `crashEventId:N`, and the server stamps the resulting `sos_event_id` on the crash row.
7. **Crash-detect threshold: combined accel + speed + sliding window.** A1 fires on Android when **linear acceleration magnitude ≥ 30 m/s² (~3g) sustained for ≥ 100 ms** AND GPS speed was ≥ 5 m/s (~18 km/h) in the **15 s preceding** the spike. iOS uses the same thresholds via `expo-sensors` `DeviceMotion` (gravity-removed). The dual gate kills false positives from phone drops while idle and from speed-bump jolts at low speed.
8. **iOS driving gate via GPS speed, not Activity Recognition.** Android already has `IN_VEHICLE` via Play Services (`location/ActivityRecognitionReceiver.kt`). iOS has no equivalent that works in self-hosted distribution, so iOS gates crash detection on **rolling GPS speed: in_vehicle iff median speed over the last 90 s ≥ 5 m/s** and the latest fix is ≤ 60 s old. App.tsx already infers `activity = 'driving'` when `speed >= 7` — A1 reuses the speed buffer behind that.
9. **Countdown UX = full-screen activity + audio + haptic.** Android: dedicated full-screen activity `CrashCountdownActivity` with `FLAG_TURN_SCREEN_ON | FLAG_KEEP_SCREEN_ON | FLAG_SHOW_WHEN_LOCKED`, plus continuous vibration pattern and a loud rising-tone alarm via `ToneGenerator` on `STREAM_ALARM` (overrides silent mode). iOS: full-screen modal `CrashCountdownModal` over the App.tsx root with `expo-haptics` and `Vibration.vibrate([0,500,500,500], true)`. Text-to-speech is **not** in scope.
10. **`crash_events` schema = summary only, not raw traces.** We persist peak magnitude, sustained-ms above threshold, GPS speed at trigger, accuracy, lat/lng, activity, and a short "max-axis breakdown" (peak x, y, z) — enough to debug a false positive after the fact without blowing storage.
11. **A2 score = 0–100, deterministic, conservative.** Formula in A2 server section. Score = 100 minus point deductions for hard-brakes-per-100km, speeding-minutes-per-driving-hour, and late-night-driving %. Floors at 0. Returned with raw component values so the UI can explain the score.
12. **iOS audio in the countdown deferred.** `expo-av` would re-add the Sprint-3 pod that already caused CI churn. Use vibration + huge visual + system haptic only for v1. Documented as a follow-up.
13. **One migration per feature.** `019_trip_events.sql` for A2 (plus the opt-in column), `020_crash_events.sql` for A1. Both are additive; rollback = drop tables + drop the nullable column.
14. **WS event additions** = `driving_score_updated` (broadcast on trip close after re-aggregation) and `crash_pending` (broadcast to the user's *own* circle so a guardian dashboard can show the countdown is live — but **not** an alarm yet; SOS-active is the alarm).
15. **Rate limits** = `POST /api/crash-events` 10/min, `POST /api/crash-events/:id/dismiss` 30/min, `GET /api/users/:id/driving-score` 30/min (same envelope as `routes/profile.js`).

---

## Server changes

### A2 — Driving safety score

**Migration `019_trip_events.sql`**

```sql
-- Per-event records during a live driving trip. Populated by server/src/trips.js
-- from incoming GPS fixes when mode resolves to 'driving'. Powers the
-- driving-safety score (hard-brakes, speeding minutes, night miles) without
-- requiring per-second samples in the locations table.

CREATE TABLE IF NOT EXISTS trip_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id       INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL CHECK(kind IN ('hard_brake','speeding_start','speeding_end','night_segment')),
    occurred_at   INTEGER NOT NULL,
    value         REAL,           -- kind-specific: hard_brake = decel m/s^2,
                                  -- speeding_* = speed m/s, night_segment = distance m
    lat           REAL,
    lng           REAL,
    meta          TEXT            -- optional JSON blob, e.g. {"deltaV":-4.2,"deltaT":3.1}
);
CREATE INDEX IF NOT EXISTS idx_trip_events_trip ON trip_events(trip_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_trip_events_user_time
    ON trip_events(user_id, occurred_at DESC);

-- Per-user opt-in flag for A1. Added here so A2's tests can already exercise
-- the column shape and A1 only has to ALTER nothing on user rows.
ALTER TABLE users ADD COLUMN crash_detection_enabled INTEGER NOT NULL DEFAULT 0;
```

**New helper `server/src/drivingScore.js`**

Exports:
- `recordTripEvents(db, tripState, fix, prevFix)` — called from `onLocationFix` in `trips.js` when `mode` resolves to driving. Detects:
  - **hard_brake** when `prevFix.speedMps - fix.speedMps >= 3.5 && (fix.recordedAt - prevFix.recordedAt) <= 6000`. Insert one row with `value = (prevFix.speedMps - fix.speedMps) / ((fix.recordedAt - prevFix.recordedAt)/1000)`. Cooldown: skip if a hard_brake for this `trip_id` exists within the last 8 s.
  - **speeding_start / speeding_end** when crossing the per-user `alert_prefs.speeding_threshold_mps`. Use existing prefs row. Pairs each start with an end on close.
  - **night_segment** when the local hour at `lat,lng,recordedAt` is in `[22,06)`. Approximate timezone from `lng` (degrees / 15) — no external lib. Insert a row with `value = haversineMeters(prevFix, fix)` so we can sum miles. Coalesce contiguous segments by checking the last `night_segment` for this trip and updating its `value` in place if `now - last.occurred_at < 60_000`.
- `computeDrivingScore(db, userId, sinceMs)` — pure SQL aggregation, returns:
  ```ts
  {
    score: number | null,     // 0–100, or null if no driving data
    days: number,             // window length in days
    tripCount: number,
    drivingMs: number,        // sum of (ended_at - started_at) where mode='driving'
    distanceM: number,
    hardBrakeCount: number,
    hardBrakePer100Km: number,
    speedingMinutes: number,  // accumulated paired speeding_start/end
    speedingThresholdMps: number,
    nightMiles: number,
    nightDrivingPct: number,
  }
  ```
  Formula:
  ```
  base = 100
  brakePenalty      = min(25, hardBrakePer100Km * 5)
  speedPenalty      = min(25, (speedingMinutes / max(1, drivingHours)) * 4)
  nightPenalty      = min(15, nightDrivingPct * 30)         // 50% night = -15
  shortDrivePenalty = drivingMs < 30*60_000 ? 5 : 0          // need >=30min in window
  score = max(0, base - brakePenalty - speedPenalty - nightPenalty - shortDrivePenalty)
  ```
  If `tripCount === 0` → return `{ score: null, ... }` so the client renders "Not enough driving data".

**Routes** (new file `server/src/routes/drivingScore.js`)

- `GET /api/users/:userId/driving-score?days=7`
  - Auth + circle-membership assertion (requester and target must share at least one circle — same pattern as `routes/trips.js` `assertMember`).
  - `days` ∈ [1, 90]. Default 7. Window = `Date.now() - days * 86_400_000`.
  - Calls `computeDrivingScore(db, userId, since)`.
  - `logView(db, requesterId, targetUserId, 'driving_score')`.
  - Rate limit: 30/min.

**Modify `server/src/trips.js`**
- Import `recordTripEvents` from `drivingScore.js`.
- In `onLocationFix`, after the "already in a trip" branch updates aggregates, call `recordTripEvents(db, live, fix, prevFix)`. Track `prevFix` on the `live` map entry (add `lastSpeedMps` and `lastRecordedAt`).
- In `closeTrip`, after marking `ended_at`, call `publish(circleId, { type: 'driving_score_updated', userId })` so the PWA/Android can re-fetch. (Plain notification ping, no payload — clients pull fresh.)

**Modify `server/src/routes/profile.js`**
- Extend `UpdateMeBody` zod schema with `crashDetectionEnabled: z.boolean().optional()`.
- In the PATCH handler, write through to `users.crash_detection_enabled`.
- `GET /api/users/me` and the login response in `routes/auth.js` return `crashDetectionEnabled: !!row.crashDetectionEnabled`.

**Register**
- `server/src/index.js`: `import drivingScoreRoutes from './routes/drivingScore.js';` and `await fastify.register(drivingScoreRoutes, { db });` after `tripsRoutes`.

**New test `server/test/driving_score.test.js`**
- Seed user + circle + a `trips` row with `mode='driving'` and `trip_events` rows: 3 hard_brakes over 50 km, 12 speeding-minutes, 0 night miles.
- Hit `/api/users/:id/driving-score?days=7`, assert score components and formula output.
- Test "no data" → `score: null`.
- Test ACL: non-circle requester → 403.

### A1 — Crash detection (auto-SOS)

**Migration `020_crash_events.sql`**

```sql
-- Crash detection audit log. One row per candidate (countdown triggered).
-- sos_event_id is populated only when the countdown completes and the client
-- POSTs /api/sos/activate with source='crash' + crashEventId. Dismissed rows
-- have dismissed_at set and sos_event_id NULL.

CREATE TABLE IF NOT EXISTS crash_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    circle_id       INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    detected_at     INTEGER NOT NULL,
    peak_accel_mps2 REAL    NOT NULL,
    sustained_ms    INTEGER NOT NULL,
    peak_axis_x     REAL,
    peak_axis_y     REAL,
    peak_axis_z     REAL,
    speed_mps       REAL,
    lat             REAL,
    lng             REAL,
    accuracy_m      REAL,
    activity        TEXT,
    platform        TEXT NOT NULL,            -- 'android' / 'ios'
    dismissed_at    INTEGER,
    sos_event_id    INTEGER REFERENCES sos_events(id) ON DELETE SET NULL,
    note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_crash_events_user_time
    ON crash_events(user_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_crash_events_circle_time
    ON crash_events(circle_id, detected_at DESC);
```

**Routes** (new file `server/src/routes/crashEvents.js`)

- `POST /api/crash-events`
  - Auth required.
  - Body (zod):
    ```
    {
      peakAccelMps2: number >= 5,
      sustainedMs:   number >= 1 <= 5000,
      peakAxisX/Y/Z: number?,
      speedMps:      number >= 0?,
      lat?, lng?, accuracyM?: numbers,
      activity?:     string,
      platform:      'android' | 'ios',
      note?:         string <= 200
    }
    ```
  - Server checks `users.crash_detection_enabled = 1` for the reporter → 403 `crash_detection_disabled` if not.
  - Resolve `circleId` via `getUserCircleId(db, userId)`.
  - Insert row, return `{ id, detectedAt }`.
  - `publish(circleId, { type: 'crash_pending', userId, displayName, crashEventId: id, detectedAt: now })` — informational only, **no FCM fanOut**.
  - Rate limit: 10/min.

- `POST /api/crash-events/:id/dismiss`
  - Auth + ownership: row.user_id must equal `req.auth.userId`.
  - If `sos_event_id IS NOT NULL` → 409 `already_escalated`.
  - Set `dismissed_at = Date.now()`. Return 204.
  - Rate limit: 30/min.

**Modify `server/src/routes/sos.js`**
- Extend `ActivateBody`:
  ```
  source:        z.enum(['user','crash']).optional(),
  crashEventId:  z.number().int().positive().optional(),
  ```
- After insert/upsert of the `sos_events` row, if `source === 'crash' && crashEventId`, run:
  ```js
  db.prepare('UPDATE crash_events SET sos_event_id = ? WHERE id = ? AND user_id = ? AND sos_event_id IS NULL')
    .run(id, crashEventId, userId);
  ```
- Include `source` in the published WS event and FCM payload so the receiving circle can show "Crash SOS" vs plain "SOS". Derive `source` on the fly in `rowToEvent` via a LEFT JOIN to `crash_events.id WHERE sos_event_id = e.id` — avoids a column add to `sos_events`.

**Register**
- `server/src/index.js`: `import crashEventRoutes from './routes/crashEvents.js';` and `await fastify.register(crashEventRoutes, { db });` after `sosRoutes`.

**New test `server/test/crash_events.test.js`**
- Test rejected when `crash_detection_enabled = 0`.
- Happy path: PATCH /me with enabled, POST /api/crash-events → row exists, WS receives `crash_pending`.
- Dismiss path → `dismissed_at` set, no sos_event linked.
- Escalate path: POST /api/crash-events → POST /api/sos/activate {source:'crash', crashEventId:N} → crash row has `sos_event_id` populated, sos response includes `source:'crash'`.
- Dismiss-after-escalate → 409.
- ACL: another user cannot dismiss someone else's crash row.

---

## Client changes

### PWA (`server/src/public/` + `server/src/views/`)

#### A2 — Driving safety score
- `views/member.html`: new "Driving safety" card section (markup with `<select id="ds-range">` for 7/30/90 days + a `<div id="ds-body">` for results).
- `public/member.js`: `loadDrivingScore(days)` calls the new endpoint and renders large score number color-coded (≥80 green, 60–79 amber, <60 red) + three component rows (hard brakes, speeding minutes, night driving %). Wire the existing WS handler to re-fetch on `driving_score_updated` when `userId === state.targetUserId`.

#### A1 — Crash detection
- PWA does **not** trigger crash detection (no reliable background sensor in browser). PWA only renders incoming `crash_pending` and SOS events.
- `views/app.html`: add `<div id="crash-banner">` slot.
- `public/app.js`: handle `crash_pending` → transient banner ("Possible crash detected for {name} — waiting for confirmation…"), auto-fade after 35 s if no `sos_active` follows. When `sos_active` arrives with `source === 'crash'`, swap copy to "Crash SOS".
- `public/settings.js` + `views/settings.html`: crash-detection toggle next to read-receipts toggle. PATCH `/api/users/me`.

### Android (`android/app/src/main/java/com/familyguardian/`)

#### A2 — Driving safety score
- `data/Models.kt`: `DrivingScore` DTO matching server shape.
- `data/ApiClient.kt`: new Retrofit endpoint `GET /api/users/{userId}/driving-score?days=`.
- `data/TripsRepo.kt`: `suspend fun drivingScore(userId: Long, days: Int = 7): DrivingScore`.
- `ui/TripsScreen.kt`: score card above the LazyColumn, with 7/30/90 chip group, color-coded number, three component rows.
- `events/GuardianEvent.kt`: `@Serializable @SerialName("driving_score_updated") data class DrivingScoreUpdated(val userId: Long)`.
- `events/EventStreamClient.kt`: polymorphic decoder picks up the new variant automatically.

#### A1 — Crash detection
- `AndroidManifest.xml`: declare `CrashCountdownActivity` with `showOnLockScreen="true" turnScreenOn="true"`. No new permissions (accelerometer is permissionless).
- New `location/CrashDetector.kt`: registers `SensorManager.TYPE_LINEAR_ACCELERATION` at `SENSOR_DELAY_GAME` from `LocationService.onCreate` when `prefs.snapshot().crashDetectionEnabled`. Sliding 100 ms window of magnitudes. Triggers when `mag >= 30.0 && sustainedMs >= 100 && lastSpeedMps >= 5.0 && now - lastFixAtMs <= 60_000 && activity == 'driving'`. 5-min cooldown between candidates.
- New `data/CrashRepo.kt`: `report(...)`, `dismiss(crashEventId)`, `activateCrashSos(crashEventId, lat, lng, accuracyM)` calling `SosRepo.activate(...)` with extended body.
- `data/Models.kt`: `SosActivateBody` gains `source`, `crashEventId`. Add `CrashReportBody`, `CrashReportResponse`. `UpdateMeBody` gains `crashDetectionEnabled`. `Profile` DTO gains `crashDetectionEnabled`.
- New `ui/CrashCountdownActivity.kt`: full-screen Compose UI on `errorContainer` background. Big "30" digit, "I'M OK — CANCEL" + "Send SOS now" buttons. `LaunchedEffect` ticks every 100 ms; on reaching 0, calls `CrashRepo.activateCrashSos(...)`. Continuous `Vibrator.vibrate(VibrationEffect.createWaveform(...))` and `ToneGenerator(STREAM_ALARM, 100)`-driven alarm. BACK pressed is ignored.
- `events/Alerts.kt`: `showCrashPending(...)` posts an `IMPORTANCE_HIGH` notification on `CHANNEL_HIGH`. Extend `showSos` to prefix "Crash SOS" when `event.source === 'crash'`.
- `events/GuardianEvent.kt`: add `CrashPending(userId, displayName, crashEventId, detectedAt)`. Extend `SosActive.source: String?`.
- `location/LocationService.kt`: expose `@Volatile var lastSpeedMps: Double?` and `@Volatile var lastFixAtMs: Long`, set in `onLocationResult`. Start/stop `CrashDetector` based on prefs flag.
- `data/Prefs.kt`: add `crashDetectionEnabled` to snapshot, DataStore key `pref_crash_detection_enabled`.
- `ui/AccountScreen.kt`: Switch row "Crash detection (auto-SOS)" → PATCH `/api/users/me` and update Prefs.

### iOS (`ios-app/App.tsx` — single-file, kept for v1)

**Dependencies (`ios-app/package.json`)**
- Add `expo-sensors` (`~14.0.0` — SDK 55 line) and `expo-haptics` (`~14.0.0`). **Defer** `expo-av` and `expo-speech`.

**Permissions (`ios-app/app.json`)**
- No new Info.plist strings (accelerometer doesn't require one on iOS). No config plugin entry needed for `expo-sensors` 14.x. Verify in PR.

**`App.tsx`**
- **A2 score card** in `MembersTab` selected-member detail: `loadDrivingScore(userId, days)` helper; render shape mirrors PWA (large color-coded number + 3 rows + 7/30/90 chips). WS handler for `driving_score_updated` invalidates the cached score for that member.
- **Driving-gate state**: `recentSpeeds: number[]` ring buffer of last 90 s of `speedMps` from the location callback. `isProbablyDriving()` = median ≥ 5 m/s AND last fix < 60 s old.
- **Crash detector**: `import { DeviceMotion } from 'expo-sensors'`. `DeviceMotion.setUpdateInterval(20)`. Subscribe and compute `mag = Math.sqrt(ax**2 + ay**2 + az**2) * 9.81` from gravity-removed acceleration. Same sliding-window logic as Android. Gated on `session.crashDetectionEnabled` AND `isProbablyDriving()`.
- On candidate: POST `/api/crash-events` → on success, set `crashState = { id, expiresAt: Date.now()+30000 }`.
- **`CrashCountdownModal`** (new component): `Modal` with `presentationStyle="fullScreen"`, bright red background, huge countdown, CANCEL + SEND NOW buttons. `useEffect` ticks 100 ms; ≤0 → `POST /api/sos/activate {source:'crash', crashEventId:id, lat, lng, accuracyM}`. Continuous `Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)` every 800 ms + `Vibration.vibrate([0,500,500], true)`.
- CANCEL → `POST /api/crash-events/${id}/dismiss` and close.
- **Settings toggle** in `MoreTab`: Switch row "Crash detection (auto-SOS)" → PATCH `/api/users/me`.
- **Dev hook**: gated by `__DEV__`, an extra "Simulate crash" button that bypasses the sensor branch and posts a fake crash event directly. Lets us verify the iOS countdown UI without a physical impact.

---

## Critical files to create / modify

**Created**
- `server/src/migrations/019_trip_events.sql`
- `server/src/migrations/020_crash_events.sql`
- `server/src/drivingScore.js`
- `server/src/routes/drivingScore.js`
- `server/src/routes/crashEvents.js`
- `server/test/driving_score.test.js`
- `server/test/crash_events.test.js`
- `android/app/src/main/java/com/familyguardian/data/CrashRepo.kt`
- `android/app/src/main/java/com/familyguardian/location/CrashDetector.kt`
- `android/app/src/main/java/com/familyguardian/ui/CrashCountdownActivity.kt`

**Modified**
- `server/src/index.js` — register `drivingScoreRoutes`, `crashEventRoutes`.
- `server/src/trips.js` — call `recordTripEvents`; carry `lastSpeedMps` + `prevFix`; publish `driving_score_updated` on trip close.
- `server/src/routes/sos.js` — accept `source` / `crashEventId`; stamp `crash_events.sos_event_id`; surface `source` in event payload.
- `server/src/routes/profile.js` — `crashDetectionEnabled` in PATCH + GET responses.
- `server/src/routes/auth.js` — login response surfaces `crashDetectionEnabled`.
- `server/src/public/member.js` — driving-score card + WS handler.
- `server/src/public/app.js` — `crash_pending` banner + `source` field in SOS toast.
- `server/src/public/settings.js` — crash-detection toggle.
- `server/src/views/member.html` — driving-safety card markup.
- `server/src/views/settings.html` — crash-detection toggle markup.
- `server/src/views/app.html` — `<div id="crash-banner">` slot.
- `android/app/src/main/AndroidManifest.xml` — `CrashCountdownActivity` declaration.
- `android/app/src/main/java/com/familyguardian/data/Models.kt` — `DrivingScore`, `CrashReportBody`, `CrashReportResponse`; extend `SosActivateBody`, `Profile`, `UpdateMeBody`.
- `android/app/src/main/java/com/familyguardian/data/ApiClient.kt` — new endpoints.
- `android/app/src/main/java/com/familyguardian/data/TripsRepo.kt` — `drivingScore(...)`.
- `android/app/src/main/java/com/familyguardian/data/SosRepo.kt` — pass `source` / `crashEventId` through.
- `android/app/src/main/java/com/familyguardian/data/Prefs.kt` — `crashDetectionEnabled`.
- `android/app/src/main/java/com/familyguardian/events/GuardianEvent.kt` — `DrivingScoreUpdated`, `CrashPending`; extend `SosActive.source`.
- `android/app/src/main/java/com/familyguardian/events/Alerts.kt` — `showCrashPending`, "Crash SOS" title prefix.
- `android/app/src/main/java/com/familyguardian/location/LocationService.kt` — expose `lastSpeedMps`/`lastFixAtMs`; wire `CrashDetector`.
- `android/app/src/main/java/com/familyguardian/ui/TripsScreen.kt` — driving-score card.
- `android/app/src/main/java/com/familyguardian/ui/AccountScreen.kt` — crash-detection toggle.
- `ios-app/package.json` — add `expo-sensors`, `expo-haptics`.
- `ios-app/App.tsx` — driving score card, sensor subscription, countdown modal, settings toggle.
- `README.md` — Driving Safety section.
- `AGENTS.md` — new tables + WS events.
- `NEXT_SPRINT_PROMPT.md` — mark Sprint 4 shipped.

---

## Reused utilities (don't re-invent)

- `requireAuth(db)` — auth prehandler on every new route.
- `getUserCircleId(db, userId)` — circle resolution for SOS + crash routes (in `routes/sos.js`).
- `haversineMeters(lat1, lng1, lat2, lng2)` from `server/src/geofence.js` — distance summing for `night_segment`.
- `publish(circleId, event)` from `server/src/hub.js` and `fanOut(...)` from `server/src/fcm.js` — already pass-through, no allowlist changes.
- `logView(db, requesterId, targetUserId, resource)` from `server/src/audit.js` — call it from the driving-score GET (new resource type `'driving_score'`).
- `Prefs` snapshot pattern in `data/Prefs.kt` — `crashDetectionEnabled` slots into the existing DataStore plumbing alongside `readReceiptsEnabled`.
- `EventBus` / WS event sealed-interface decoding — new variants auto-decode via `@SerialName`.
- `inferActivity` helper in `ios-app/App.tsx` — already uses a `speed >= 7` heuristic; A1 reuses the same speed buffer.

---

## Verification (end-to-end)

```bash
# Clean test server
cd "h:/family-guardian/server"
rm -rf data/test.db* data/uploads tmp-test 2>/dev/null
DATABASE_PATH="$(pwd)/data/test.db" PORT=8765 npm start
until curl -sf http://127.0.0.1:8765/healthz >/dev/null 2>&1; do sleep 1; done; echo READY
# Bootstrap signup -> $TOKEN (see HANDOFF.md snippet)

# --- A2 driving score ---

# No driving data yet
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8765/api/users/1/driving-score?days=7"
# Expect 200, score: null, tripCount: 0.

# Seed trip + trip_events via sqlite3
sqlite3 data/test.db <<'SQL'
INSERT INTO trips (user_id, circle_id, started_at, ended_at, mode, distance_m, max_speed_mps, avg_speed_mps)
VALUES (1, 1, strftime('%s','now','-2 days')*1000, strftime('%s','now','-2 days')*1000 + 3600000,
        'driving', 50000, 30, 18);
INSERT INTO trip_events (trip_id, user_id, kind, occurred_at, value) VALUES
  (last_insert_rowid(), 1, 'hard_brake',    strftime('%s','now','-2 days')*1000, -4.2),
  (last_insert_rowid(), 1, 'hard_brake',    strftime('%s','now','-2 days')*1000 + 30000, -3.8),
  (last_insert_rowid(), 1, 'speeding_start',strftime('%s','now','-2 days')*1000 + 60000, 35.0),
  (last_insert_rowid(), 1, 'speeding_end',  strftime('%s','now','-2 days')*1000 + 660000, 28.0),
  (last_insert_rowid(), 1, 'night_segment', strftime('%s','now','-2 days')*1000 + 700000, 5000);
SQL

curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8765/api/users/1/driving-score?days=7"
# Expect score < 100 with hardBrakeCount=2, speedingMinutes≈10, nightMiles=5.

# --- A1 crash detection ---

# Opt-in gate (must reject when disabled)
curl -sX POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"peakAccelMps2":32.0,"sustainedMs":140,"speedMps":15.0,"platform":"android"}' \
  http://127.0.0.1:8765/api/crash-events
# Expect 403 crash_detection_disabled.

curl -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"crashDetectionEnabled":true}' http://127.0.0.1:8765/api/users/me
# Expect 200 with crashDetectionEnabled:true.

CID=$(curl -sX POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"peakAccelMps2":32.0,"sustainedMs":140,"speedMps":15.0,"platform":"android","lat":37.77,"lng":-122.42,"accuracyM":12}' \
  http://127.0.0.1:8765/api/crash-events | jq .id)
echo "crash event id: $CID"   # WS subscriber should see crash_pending.

# Escalate
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"source\":\"crash\",\"crashEventId\":$CID,\"lat\":37.77,\"lng\":-122.42}" \
  http://127.0.0.1:8765/api/sos/activate
# Expect 200 sos_event with source:'crash'. WS subscriber sees sos_active with source:'crash'.
sqlite3 data/test.db "SELECT id, sos_event_id, dismissed_at FROM crash_events WHERE id=$CID;"
# Expect sos_event_id NOT NULL, dismissed_at NULL.

# Dismiss path
CID2=$(curl -sX POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"peakAccelMps2":33,"sustainedMs":150,"speedMps":18,"platform":"ios"}' \
  http://127.0.0.1:8765/api/crash-events | jq .id)
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8765/api/crash-events/$CID2/dismiss
# Expect 204. Row has dismissed_at, no sos_event_id.

# Run vitest after each phase
npm test  # expect existing 83 + new tests passing
```

**UI smoke (per surface):**
- **PWA / member page** — Driving Safety card renders a number with color band; switching range chips re-fetches; after closing a synthetic trip via sqlite3, the WS `driving_score_updated` triggers a re-fetch.
- **PWA / settings** — Crash-detection toggle persists across reload.
- **Android Trips screen** — Score card above the trip list updates when toggling 7/30/90.
- **Android crash flow** — Toggle ON in Account, then trigger via adb sensor injection (or shake hard with debug-only override); `CrashCountdownActivity` appears full-screen even on the lock screen, vibrates, beeps via `STREAM_ALARM`. CANCEL → server row has `dismissed_at`; let it expire → SOS goes out and the rest of the circle sees "Crash SOS" on PWA.
- **iOS crash flow** — On a physical device, enable the toggle, then trigger via the `__DEV__`-gated "Simulate crash" button. Modal occupies full screen, vibrates, countdown ticks, expires → SOS with `source:'crash'`.
- **iOS driving-gate sanity** — In debug, log `recentSpeeds` median + last fix age every 5 s. Walking → `isProbablyDriving` false. Driving ≥30 s above 5 m/s → true.

**Cleanup after testing:**
```bash
PID=$(netstat -ano | grep :8765 | grep LISTENING | head -1 | awk '{print $5}')
if [ -n "$PID" ]; then taskkill //F //PID $PID; fi
rm -rf h:/family-guardian/server/data/test.db* h:/family-guardian/server/data/uploads h:/family-guardian/server/tmp-test
```

---

## Risks and pause points

- **GPS speed noise at low fix intervals.** Hard-brake detection from speed deltas assumes `locations` is populated frequently enough during a trip. Default Android interval is 30 s. A 6 s Δt window means we rely on consecutive fixes catching the speed drop. The first ship will likely **miss** brakes that resolve between two 30 s fixes. Mitigation: doc-only for v1; consider tightening `setMinUpdateIntervalMillis(5000)` during driving in a follow-up. Test the score formula by seeding `trip_events` directly.
- **False positives from phone drops.** The dual gate (≥30 m/s² for 100 ms AND speed ≥ 5 m/s in the last 15 s AND activity=driving) is conservative but not foolproof. The 30 s countdown is the user's main defense. Track dismissed-without-escalation rates in `crash_events` to tune thresholds post-ship.
- **Pocket detection / phone facing down.** Accelerometer still works in a pocket. Audio + vibration during the countdown are critical. Android uses `STREAM_ALARM` (overrides silent). iOS countdown is visual + vibration only for v1 because adding `expo-av` would re-open the pod fragility. Documented in Settings copy.
- **iOS Expo dependency fragility.** Adding **two** new Expo modules (`expo-sensors`, `expo-haptics`) is the biggest CI risk. Test the iOS build (`npx expo prebuild --platform ios && cd ios && pod install`) at the **very start of A1**, before touching App.tsx. If the pod chain breaks, fall back to **just `expo-sensors`** (skip haptics — use `Vibration` from `react-native`, which is built-in).
- **`crash_events.sos_event_id` race.** Dismiss-at-the-exact-moment-of-fire: both endpoints could run. The dismiss handler's `409 already_escalated` covers "SOS already fired"; the SOS endpoint's `UPDATE … WHERE sos_event_id IS NULL` covers the reverse. Both are single-statement SQLite updates so they serialize.
- **`trips.lastSpeedMps` lost across restarts.** `loadOpenTrips` rebuilds the in-memory map from open rows but loses `lastSpeedMps` (only `lastAt` survives the SELECT). Mitigation: on restart, set `lastSpeedMps = null` and skip the first hard-brake comparison. One missed brake at restart is acceptable.
- **Night-time approximation by longitude.** `lng / 15` is accurate to ~1 timezone for non-extreme latitudes and ignores DST. Good enough for "is this night driving" within ±1 hour. Documented as such.
- **Driving-score privacy.** Endpoint gated by circle membership (same as trips). No new disclosure surface. Score is per-user; `view_audits` logs each fetch.
- **Pause after each sub-feature (A2 → A1) for human verification** before moving on, per house rules.

---

## House rules carry-over

- Fix critical issues, then ship features + open source for the world.
- Don't add features beyond scope; don't over-engineer.
- Use TaskCreate/TaskUpdate to track multi-step work. One task in_progress at a time.
- Test on a live server (not just syntax-check) before claiming a phase done.
- Pause after big milestones; let the human verify before proceeding.
- Don't commit unless asked. Don't push, ever, without permission.
