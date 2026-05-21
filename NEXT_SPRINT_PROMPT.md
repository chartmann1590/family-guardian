# Family Guardian — Next Sprint Prompt

> Paste this whole file into a fresh Claude Code session at `h:\family-guardian` and tell the agent: **"Pick up the Family Guardian work — read NEXT_SPRINT_PROMPT.md and continue with Sprint 1 (Privacy & Control). Also read HANDOFF.md for repo conventions before touching anything."**

This prompt is the approved feature roadmap as of 2026-05-19. **Sprint 1 (Privacy & Control)** is the focused sprint; Sprints 2–4 are sketched only. Three design decisions are locked in:
- **Soft pause** for pause-sharing (frozen last-known location + badge, not full disappear).
- **30s countdown → auto-SOS** for crash detection (Sprint 4).
- **One focused theme per round** — finish Sprint 1 cleanly before opening Sprint 2.

Repo conventions, dev-environment quirks, and "things that bit us last time" are in `HANDOFF.md`. **Read that file first**, especially:
- Local ESM imports use `.js` extensions.
- `db.transaction(() => { … })()` is synchronous (better-sqlite3).
- Pino logs (`req.log.warn({…}, 'event_name')`), not `console.log`.
- Web template `render()` in `routes/web.js` runs **raw replace before safe replace** — don't reorder.
- New migrations: `server/src/migrations/NNN_name.sql`, lexical order, auto-run, tracked in `_migrations`.
- New routes: `server/src/routes/<name>.js`, default export `async (fastify, { db, … })`, register in `server/src/index.js`.
- Android DTOs in `data/Models.kt` with `@Serializable`; add to ProGuard keep rules if new packages.
- Test workflow: `DATABASE_PATH="$(pwd)/data/test.db" PORT=8765 npm start` from `server/`, clean up with the rm command at the bottom of HANDOFF.md.
- Don't commit unless asked. Don't push, ever, without permission.

---

## Roadmap at a glance

| Sprint | Theme | Status |
|---|---|---|
| 1 | **Privacy & Control** — pause sharing, view-audit log, data export & account delete | **Shipped** |
| 2 | **Smart Notifications + Reactions** — per-place/per-member subscriptions, message reactions, test suite | **Shipped** |
| 3 | Chat polish (voice notes, photo check-ins, typing/read) | Sketched |
| 4 | Driving safety (crash detection auto-SOS + driving safety score) | Sketched |

**Why privacy first.** Family Guardian's pitch is "self-hosted family safety — your box, your data." Shipping pause / audit / export *before* more tracking features is what defensibly separates it from "Life360 on a VPS." Trust foundation goes in first, the rest builds on top.

---

## Sprint 1 — Privacy & Control (SHIPPED)

C1 (pause sharing), C2 (view audit log), C3 (data export + account delete) — all done.

---

## Sprint 2 — Smart Notifications + Reactions (SHIPPED)

D1 (notify-on-arrival/departure with `place_subscriptions` table, `inQuietHours`, targeted `fanOutToUsers`), D2 (message reactions with `message_reactions` table, 6-emoji allowlist, WS events) — all done. 59 tests passing in vitest.

Three features. Each touches **server + Android + iOS + PWA**. All four surfaces already have the structure to absorb the change without rewriting.

### C1 — Pause sharing (soft pause)

**Server**
- `server/src/migrations/012_pause_sharing.sql`:
  ```sql
  ALTER TABLE users ADD COLUMN paused_until INTEGER;          -- ms epoch, NULL = not paused
  ALTER TABLE users ADD COLUMN pause_reason TEXT;             -- optional, ≤140 chars
  CREATE INDEX IF NOT EXISTS idx_users_paused_until ON users(paused_until)
    WHERE paused_until IS NOT NULL;
  ```
- New route `server/src/routes/pause.js`, registered in `index.js`:
  - `POST /api/users/me/pause` body `{durationMinutes: number (1–1440), reason?: string}` → sets `paused_until`, broadcasts `pause_changed` over the circle's WS hub, returns refreshed state.
  - `DELETE /api/users/me/pause` → clears pause, broadcasts.
  - `GET /api/users/me/pause` → current `{pausedUntil, reason}`.
- Hot path — `routes/locations.js`:
  - If caller is paused, still INSERT into `locations_history` (user's own history stays intact), but **skip** the UPSERT into `locations` and **skip** the `location_update` hub broadcast. Same `db.transaction(...)` wrapper from Phase 0 — just gated on the pause flag.
- Member list queries in `routes/locations.js` (`GET /api/circles/:id/members`) and `routes/web.js`:
  - Add `paused`, `pausedUntil` columns to the SELECT. Frozen `lat/lng/recordedAt` come naturally because we stopped upserting `locations`.
- New WS event in `hub.js` (no allowlist — it's pass-through):
  - `{type: "pause_changed", userId, pausedUntil, reason}`.
- Extend `server/src/scheduler.js` (already runs every 60s for `offline_alert`):
  - Find rows where `paused_until IS NOT NULL AND paused_until < now`, set to NULL, broadcast `pause_changed`.
- Rate-limit `POST /api/users/me/pause` at 30/hr (consistent with existing per-route limits in `routes/profile.js`).

**Android** (`android/app/src/main/java/com/familyguardian/`)
- `data/Models.kt`: add `paused: Boolean? = null, pausedUntil: Long? = null` to the `Member` DTO. New `PauseState(pausedUntil: Long?, reason: String?)`.
- `data/PauseRepo.kt` (new) — mirrors `SosRepo.kt`:
  - `suspend fun pause(durationMinutes: Int, reason: String?): PauseState`
  - `suspend fun unpause()`
  - `suspend fun current(): PauseState`
- `events/GuardianEvent.kt`: add `data class PauseChanged(val userId: Int, val pausedUntil: Long?) : GuardianEvent`. `EventStreamClient` decodes via the existing `type` discriminator.
- `ui/MapScreen.kt`:
  - Kebab menu → "Pause sharing" → Compose `ModalBottomSheet` with quick options 15 min / 1 hr / 4 hr / Until tonight (8 PM local) / Custom + reason text field.
  - Paused members' markers and avatars get a small `⏸` overlay + "paused until 5:30 PM" subtitle. Frozen-at-time location stays visible (soft-pause spec).
- `ui/Avatar.kt`: extend signature with `pausedUntil: Long?` and render the badge.
- `MainActivity.kt`: route the WS `PauseChanged` event into the existing member-state map so markers update in real time.
- **Battery decision**: `location/LocationReporter` keeps reporting even when paused — privacy is enforced server-side, and we want history continuity. Add a one-line comment with the *why*.

**iOS** (`ios-app/App.tsx` — single-file Expo app)
- Extend `Member` type with `paused?: boolean; pauseUntil?: number; pauseReason?: string`.
- "More" tab → new "Pause sharing" row → `Alert.alert` action sheet with the same quick options.
- Map markers (`react-native-maps`): paused members get a gray overlay + small `⏸` label.
- WS message handler: process incoming `pause_changed` to update member state.

**PWA** (`server/src/public/` + `server/src/views/`)
- `public/app.js`: pause badge on sidebar avatars + Leaflet marker (`L.divIcon` with the `⏸` glyph). Add `pause_changed` to the WS event switch.
- `public/settings.js` + `views/settings.html`: new "Pause sharing" section with the same quick options.
- `public/units.js` already has a date formatter; reuse for the "until 5:30 PM" rendering.

**Acceptance**
- Pause for 1 minute → location reports continue (verify in `locations_history`), but `locations` row and `location_update` WS event stop. After 60–120s, scheduler clears the pause and broadcasts `pause_changed`. Browser map resumes movement.
- Two browser sessions: A pauses → B sees A's marker freeze + `⏸` badge update in real time without refresh.
- Android paused → other member's iOS shows the `⏸` overlay; PWA dashboard the same.

---

### C2 — Audit log of who viewed your history

**Server**
- `server/src/migrations/013_view_audits.sql`:
  ```sql
  CREATE TABLE IF NOT EXISTS view_audits (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      viewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resource   TEXT NOT NULL CHECK(resource IN ('history','visits','trips','member_page')),
      created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_view_audits_subject
      ON view_audits(subject_id, created_at DESC);
  ```
- New helper `server/src/audit.js`:
  - `logView(db, viewerId, subjectId, resource)` — inserts unless the last entry for the same `(viewer, subject, resource)` is < 5 min old (debounce). Self-views skipped (`viewer_id === subject_id`).
- Wire `logView()` into:
  - `routes/locations.js` → `GET .../members/:userId/history`
  - `routes/visits.js` → `GET .../members/:userId/visits`
  - `routes/trips.js` → `GET .../members/:userId/trips`
  - `routes/web.js` → `GET /member/:userId` HTML route
- New route `GET /api/users/me/view-log?days=7` in `routes/profile.js`:
  - Returns rows where `subject_id = me`, joined to `users` for the viewer's display name + photo.
  - Default 7 days, cap 30.
  - Caller can only see views *of themselves* — never others'. That's the whole point.

**Android**
- `data/AuditRepo.kt` (new) — single `getMyViewLog(days: Int): List<ViewLogEntry>`.
- `ui/ViewLogScreen.kt` (new) — chronological list, grouped by day (reuse `ChatScreen.kt`'s `itemsWithDayHeaders`).
- Add nav entry under Settings / About.

**iOS**
- "More" tab → "Who viewed me" row. Simple `FlatList`, same shape as the existing alerts list.

**PWA**
- `views/settings.html` → new "Who viewed your history" section. Server-rendered initial list + `public/settings.js` refresh.

**Acceptance**
- Alice views Bob's history → row inserted with `resource='history'`. Inside 5 min, Alice re-views → no new row (debounce). After 5 min, fresh row.
- Bob calls `GET /api/users/me/view-log` → sees Alice's view with display name + photo. Alice calling the same endpoint as herself sees Bob's views *of Alice*, not Alice's views *of Bob*.

---

### C3 — Data export + account deletion

**Server**
- New route `server/src/routes/account.js`:
  - `GET /api/users/me/export` — rate-limit 1/day per user. JSON streamed via Fastify (`reply.type('application/json').send(...)`), structure:
    ```json
    {
      "exportedAt": 1762800000000,
      "user": {...},
      "circle": {"id": 1, "name": "Hartmann"},
      "locationsHistory": [...],
      "visits": [...],
      "trips": [...],
      "messages": [...],
      "checkins": [...],
      "sosEvents": [...],
      "alertEvents": [...],
      "places": [...],
      "viewAudits": [...]
    }
    ```
    Photos referenced by path (full bytes would blow request size — separate `GET /api/users/me/export/photo` if needed later).
    `Content-Disposition: attachment; filename="family-guardian-export-<userId>-<yyyymmdd>.json"`.
  - `DELETE /api/users/me` body `{password}` (re-confirm). Verifies password via existing `auth.js` `verifyPassword`. Then:
    - If user is the only admin of their circle → 409 `{error: "requires_admin_handoff"}`.
    - Otherwise, `DELETE FROM users WHERE id = ?`. FK cascades handle most child rows; explicit DELETE for non-cascading tables (`locations`, `view_audits` where it's the viewer, `geocode_cache` no-op).
  - `POST /api/circles/:id/admins/:userId` (admin-only) — flip `users.is_admin = 1`. Needed so users can hand off admin before deleting themselves.

**Android / iOS / PWA**
- Settings → new "Account" section with two buttons:
  - **Export my data** → triggers download (Android `DownloadManager` with the bearer token; iOS `FileSystem.downloadAsync`; PWA `<a download>`).
  - **Delete my account** → confirm dialog with password re-entry. On 409 with `requires_admin_handoff`, prompt admin to promote a co-admin from the member list, then retry.

**Acceptance**
- Alice signs up, posts a few locations + messages + a check-in. `GET /api/users/me/export` returns JSON with all of it. Spot-check: counts in JSON match `SELECT COUNT(*) FROM <table> WHERE user_id = <Alice>`.
- Alice tries to delete → if sole admin, 409. Promotes Bob, retries → 204, all her rows gone. Bob's dashboard still works.

---

## Sprint 1 — Files to touch

**Created**
- `server/src/migrations/012_pause_sharing.sql`
- `server/src/migrations/013_view_audits.sql`
- `server/src/routes/pause.js`
- `server/src/routes/account.js`
- `server/src/audit.js`
- `android/app/src/main/java/com/familyguardian/data/PauseRepo.kt`
- `android/app/src/main/java/com/familyguardian/data/AuditRepo.kt`
- `android/app/src/main/java/com/familyguardian/ui/ViewLogScreen.kt`

**Modified**
- `server/src/index.js` — register two new routes
- `server/src/routes/profile.js` — add `GET /api/users/me/view-log`
- `server/src/routes/locations.js` — pause gate + include pause cols in member list, wire `logView`
- `server/src/routes/visits.js`, `routes/trips.js`, `routes/web.js` — wire `logView`
- `server/src/scheduler.js` — auto-expire paused rows
- `android/app/src/main/java/com/familyguardian/data/Models.kt` — pause cols
- `android/app/src/main/java/com/familyguardian/events/GuardianEvent.kt` — `PauseChanged`
- `android/app/src/main/java/com/familyguardian/ui/MapScreen.kt` — pause UI
- `android/app/src/main/java/com/familyguardian/ui/Avatar.kt` — pause badge
- `android/app/src/main/java/com/familyguardian/ui/AboutScreen.kt` (or settings host) — links to ViewLog / export / delete
- `ios-app/App.tsx` — `Member` type, pause UI, view-log section, account section
- `server/src/public/app.js` — pause badge on markers, `pause_changed` handler
- `server/src/public/settings.js` — pause section + view-log + account section
- `server/src/views/settings.html` — new sections
- `README.md` — Privacy section + API table
- `AGENTS.md` — note new tables + WS event

---

## Verification (end-to-end)

```bash
# Boot a clean test server
cd "h:/family-guardian/server"
rm -rf data/test.db* data/uploads tmp-test 2>/dev/null
DATABASE_PATH="$(pwd)/data/test.db" PORT=8765 npm start
# wait for boot, then:

# C1 — pause sharing
TOKEN=...   # from bootstrap signup, see HANDOFF.md "Bootstrap signup" snippet
curl -sX POST http://127.0.0.1:8765/api/users/me/pause \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"durationMinutes":1, "reason":"testing"}'
# POST a location; verify `locations_history` got a row but `locations` did not change.
# Wait ~70s; scheduler should clear the pause; WS event should fire.

# C2 — audit log
# As Alice, hit Bob's history endpoint. Then as Bob, GET /api/users/me/view-log.
# Should see exactly one row referencing Alice (debounced if you repeat inside 5 min).

# C3 — export
curl -sf -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8765/api/users/me/export -o export.json
# spot-check: jq '.locationsHistory | length' should match SQLite COUNT.

# C3 — delete
curl -sX DELETE http://127.0.0.1:8765/api/users/me \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"password":"hunter2hunter"}'
# Expect 409 if sole admin. Promote second admin first, then retry → 204.
```

UI smoke (one rep each):
- PWA: log in as A on Chrome, B on Firefox. A pauses → B's map freezes A's marker + adds `⏸` badge. A unpauses → motion resumes.
- Android (or Expo Go for iOS): same scenario across devices.
- Export button downloads valid JSON; delete button (after admin handoff) logs out + clears local state.

**Recommended execution order**
1. C1 server side (migration + route + locations gate + scheduler tick), syntax-check, smoke-test via curl.
2. C1 PWA (smallest client surface, fastest visual confirmation that pause works).
3. C1 Android, then C1 iOS.
4. C2 server, then PWA, Android, iOS.
5. C3 server, then PWA, Android, iOS.
6. README + AGENTS.md updates last.

Pause after each sub-feature (C1 / C2 / C3) for the human to verify before moving on.

---

## Sprint 2+ roadmap (deferred — sketched for context only)

### Sprint 2 — Notify-on-arrival / -departure (D1)
- Migration: `place_subscriptions(id, user_id, place_id, member_id, on_enter, on_exit, quiet_start, quiet_end)`.
- `server/src/geofence.js`: after detecting a transition, look up subscriptions matching `(place_id, member_id)` and dispatch notifications only to subscribers (still keep today's circle-wide WS event for the live dashboard).
- PlacesScreen on all surfaces gets a "Notify me when [member] [arrives/leaves]" toggle list.

### Sprint 3 — Chat polish (B1–B4)
- `messages` gets `attachment_path`, `attachment_kind`, `attachment_size`. New multipart upload route for voice notes (m4a, ≤2 MB).
- Photo check-ins: optional photo on `POST /api/checkins`. EXIF strip server-side (reuse `routes/profile.js` pattern).
- `message_reactions(message_id, user_id, emoji)`.
- WS-only `chat_typing` event. Optional persistent `message_reads`.

### Sprint 4 — Driving safety (A1+A2)
- Crash detection: Android `SensorManager.TYPE_LINEAR_ACCELERATION` + iOS `expo-sensors` Accelerometer. Threshold ~ 3g for ≥100 ms while `activity = driving`. Trigger 30-second full-screen `CrashCountdownScreen` → if not dismissed, fire `POST /api/sos/activate` with `source: "crash"`.
- Server: `crash_events` table (audit/postmortem), reuse `sos_events` for the active alert.
- Driving safety score: derive from `trips` (hard-brake count, max-speed-over-limit minutes, late-night driving %). New `GET /api/users/:id/driving-score?days=7`. Render on Android Trips screen + PWA member page.

---

## House rules (locked-in by the human)

- Goal: **fix critical issues, then ship features** + **open source for the world**.
- Don't add features beyond the scope of the current task. Don't over-engineer.
- Use TaskCreate/TaskUpdate to track multi-step work. One task in_progress at a time.
- Test on a live server (not just syntax-check) before claiming a phase done.
- Pause after big milestones; let the human verify before proceeding.
- Don't commit unless the human asks. Don't push, ever, without permission.
