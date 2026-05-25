# Sprint 8 Plan — Family Guardian

## Context

Sprint 7 (commit `7cd9d17`, May 24) shipped iOS parity, dwell-time routines, routine templates, curfew/bedtime, low-battery push, and emergency contacts. Sprint 7.5 (commit `c828ff2`, May 25) closed CodeQL alerts and synced the marketing site through Sprint 7.

The product is now production-shaped on all three clients (server, Android, iOS, PWA). One hard parity gap remains, several "planned follow-up" polish items were explicitly deferred in Sprints 4 and 7, and the product has reached enough alert-volume surface that the next user pain is **notification control**, not new alert kinds.

**Theme**: *Platform Completeness & Notification Intelligence*

**Why**: 
- Explicit Sprint-7 carryover (`README.md:375`): Android `EmergencyContactsScreen` / `EmergencyContactsRepo` — DTOs + API client already exist; only the UI is missing.
- Multiple deferred follow-ups from prior plans (`SPRINT_4_PLAN.md:810` crash audio, `SPRINT_7_PLAN.md:810-811` persistent low-battery state + pending-invite expiry).
- After 7 sprints of accreting alert kinds (geofence, speeding, low-battery, offline, routine-deviation, curfew, crash, SOS, place-presence), users have no snooze/bundling controls. This is the right sprint to add intelligence before alert fatigue erodes engagement.
- FCM is wired in `firebase-admin` deps and `fcm.js` stub exists but currently logs "FCM disabled" — push reaches WS-connected clients only. Background reliability needs the live path.

**Out of scope this sprint**: production-signed Android/iOS builds (dropped — current sideload story is documented; no user-pull yet); video messaging; user-contributed routine templates; place heatmap UI; driving-mode auto-pause (needs user research first); audit log CSV export (JSON export already covers data portability).

---

## Phase 1 — Close the Sprint-7 carryovers

These are explicit, scoped, already-designed deferred items with data layer ready or migrations sketched.

### P1.1 — Android EmergencyContactsScreen + EmergencyContactsRepo
- **Files to create**:
  - `android/app/src/main/java/com/familyguardian/data/EmergencyContactsRepo.kt`
  - `android/app/src/main/java/com/familyguardian/ui/EmergencyContactsScreen.kt`
- **Files to modify**:
  - `android/app/src/main/java/com/familyguardian/ui/MoreScreen.kt` — add navigation entry alongside Routines/Digest/etc.
  - `android/app/src/main/java/com/familyguardian/MainActivity.kt` — register route in NavGraph
- **Reuse**: API methods in `android/app/src/main/java/com/familyguardian/data/ApiClient.kt` (`getEmergencyContacts`, `inviteEmergencyContact`, `respondEmergencyContact`, `revokeEmergencyContact`), DTOs in `Models.kt`.
- **Pattern to follow**: `PlacesScreen.kt` for list+invite UX; `AlertSettingsScreen.kt` for the simpler "settings sub-screen with form" layout.
- **Acceptance**: PWA parity — invite by email, see pending/accepted/revoked, revoke, accept incoming. Matches behavior in `server/src/public/settings.html` emergency-contacts section.

### P1.2 — Pending-invite expiry (server)
- **New migration**: `server/migrations/029_emergency_contact_expiry.sql` — add `pending_expires_at` column (default `invited_at + 7 days`)
- **Files to modify**:
  - `server/src/routes/emergencyContacts.js` — filter expired pending invites in list endpoints; reject `respond` on expired invites
  - `server/src/scheduler.js` — sweep job every 10 min that hard-deletes invites where `status='pending' AND pending_expires_at < now()`
- **Reference**: deferred in Sprint 7 Decision #8 (`SPRINT_7_PLAN.md:811`).
- **Acceptance**: vitest case adds an invite with `invited_at` 8 days ago → not returned by list endpoint, deleted by sweep, `respond` returns 410 Gone.

### P1.3 — Persistent low-battery state
- **New migration**: `server/migrations/030_low_battery_state.sql` — `last_battery_state(user_id PRIMARY KEY, last_pct INT, last_alert_at INT)` table
- **Files to modify**:
  - `server/src/scheduler.js` — replace in-memory `Map` in `runLowBatterySweep()` with table read/write; preserve the falling-edge + hysteresis logic from Sprint 7
- **Reference**: Sprint 7 Decision #7 (`SPRINT_7_PLAN.md:810`) explicitly punted this — implement now.
- **Acceptance**: Restart server with one member at 12% → no duplicate low-battery alert. Same member then drops to 8% → new alert fires.

### P1.4 — iOS crash-detection audio cue
- **Files to modify**:
  - `ios-app/App.tsx` — extend the 30s crash countdown to play a looping siren using `expo-audio` (NOT `expo-av` — pod fragility flagged in Sprint 4 Decision #10).
  - Add audio asset `ios-app/assets/sounds/crash-countdown.m4a` (royalty-free, 1-second loop).
  - `ios-app/package.json` — add `expo-audio` dependency.
- **Reference**: `SPRINT_4_PLAN.md:810` — "Use vibration + huge visual + system haptic only for v1. Add audio in v2."
- **Acceptance**: Trigger test crash event in dev build → 30s countdown plays audible siren in addition to existing haptic + visual. Audio stops on dismiss or auto-SOS fire.

### P1.5 — FCM live wire-up (gated, optional path preserved)
- **Files to modify**:
  - `server/src/fcm.js` — wire real `firebase-admin.messaging().sendEachForMulticast()` calls with retry + invalid-token cleanup; preserve the no-op log path when `FCM_SERVICE_ACCOUNT_PATH` is unset
  - `server/src/routes/sos.js`, `routes/crashEvents.js`, `scheduler.js` — replace WS-only event broadcasts with FCM+WS dual dispatch for **background-critical alerts only**: `sos_active`, `crash_detected`, `curfew_violation`, `routine_deviation`, `low_battery`. **NOT** `location_update` or `typing` (too chatty for push).
  - `server/migrations/031_fcm_tokens_meta.sql` — add `platform`, `last_seen_at` to `fcm_tokens` to drive cleanup
  - `docs/setup.html` + `README.md` setup section — document `FCM_SERVICE_ACCOUNT_PATH` step
- **Acceptance**: With env var set, SOS triggers a real push on a backgrounded Android device (verifiable with `adb logcat | grep FCM`). With env var unset, behavior is identical to today (existing 59 vitest tests pass without modification).

**Phase 1 verification gate**: All Android screens reach parity with PWA. iOS crash audio works in dev build. FCM optional path still passes existing 59 tests. Run `cd server && npm test`.

---

## Phase 2 — Notification Intelligence

The genuine new user value of this sprint. Three intelligence layers that together address alert fatigue.

### P2.1 — Per-alert-type snooze
- **New migration**: `server/migrations/032_alert_snoozes.sql` — `alert_snoozes(user_id, alert_type, snooze_until)` with PK on `(user_id, alert_type)`
- **Files to modify**:
  - `server/src/routes/alertPrefs.js` — `POST /api/users/me/alert-snooze` (body: `{ alertType, durationMinutes }`), `DELETE /api/users/me/alert-snooze/:alertType`, `GET /api/users/me/alert-snoozes` (list active)
  - `server/src/lib/snooze.js` (new) — `isSnoozed(userId, type)` helper called from dispatch paths
  - `server/src/scheduler.js`, `routes/locations.js`, `routes/sos.js` — gate push dispatch on `isSnoozed`. **SOS and crash-detected are never snoozable** — enforce server-side regardless of payload.
  - PWA `server/src/public/settings.html` + Android `AlertSettingsScreen.kt` + iOS MoreTab — add snooze chips (1h, 4h, 24h, "Until tomorrow 8am") per alert type, with "Cancel snooze" action
- **Pattern**: reuse the quiet-hours suppression logic in `server/src/geofence.js` for the time-window check pattern.
- **Acceptance**: Snooze `low_battery` for 1h → no low_battery push fires for 60 min, but `alert_events` row is still written (for the timeline). SOS continues to fire regardless of any snooze setting.

### P2.2 — Smart bundling for routine deviations
- **Why**: Three kids each missing arrival fire three separate pushes within 5 min. Bundle into one digest push.
- **Files to create**:
  - `server/src/lib/notificationBundler.js` — `BundlingBuffer` class with in-memory `Map<watcherId, { events: [], scheduledFlush: setTimeout }>` and a 60s flush window
- **Files to modify**:
  - `server/src/scheduler.js` — `runRoutineSweep()` enqueues events into the bundler instead of immediate dispatch; on flush, emit a single bundled push + single WS event with the event array
  - `server/src/routes/locations.js` — same pattern for geofence enter/exit bursts (per-watcher per-place)
  - PWA + Android + iOS — render bundled alerts as an expandable card. Single-event bundles render exactly as today (no UI regression).
- **Acceptance**: Three simultaneous routine deviations to the same watcher within 60s → 1 push, 3 `alert_events` rows, 1 WS frame.

### P2.3 — Per-user weekly digest timing (timezone-aware)
- **Why**: Hard-coded Sunday 18:00 server-local doesn't fit users outside the server's timezone or with non-weekend cadence.
- **New migration**: `server/migrations/033_digest_prefs.sql` — extend `alert_prefs` with `digest_day_of_week` (0–6, default 0=Sunday), `digest_hour_local` (0–23, default 18), `digest_timezone` (default `Etc/UTC`)
- **Files to modify**:
  - `server/src/digest.js` — generate per-user (not per-circle) and respect timezone offsets via Luxon (add `luxon` dependency to `server/package.json`)
  - `server/src/scheduler.js` — `runDigestSweep()` becomes a per-user fire check that runs every minute, fires when the user's local time matches their config
  - `server/src/routes/alertPrefs.js` — extend GET/PATCH to include digest fields
  - PWA `settings.html` + Android `DigestScreen.kt` + iOS DigestScreen.tsx — picker UI (day-of-week dropdown + time picker; timezone is auto-detected client-side and sent on save)
- **Acceptance**: User in `America/New_York` selects "Saturday 8am" → digest WS event + push fires at 8:00am ET (13:00 UTC) on Saturday, regardless of server's clock. User in `Europe/Paris` selects "Sunday 19:00" → fires at the correct Paris-local hour.

**Phase 2 verification gate**: Run new vitest suites (`alertSnooze.test.js`, `notificationBundler.test.js`, `digestPrefs.test.js`). Manually verify snooze + bundling on at least Android + PWA. iOS picker can lag if time-boxed.

---

## Phase 3 — Stretch (small, theme-aligned)

Tight stretch items that round out the theme without bloating scope. Defer to Sprint 9 if Phases 1+2 consume the sprint.

### P3.1 — Auto-revoke emergency contacts on circle exit
- **Why**: When a user leaves a circle, their listed emergency contacts retain access until manually revoked. Privacy completeness.
- **New migration**: `server/migrations/034_emergency_contact_auto_revoke.sql` — add `auto_revoke_on_circle_exit BOOLEAN DEFAULT 0` to `emergency_contacts`
- **Files to modify**:
  - `server/src/routes/circles.js` — in the `DELETE /api/circles/:id/members/:userId` handler, also `DELETE FROM emergency_contacts` where the removed user is the subject AND `auto_revoke_on_circle_exit=1`
  - PWA `settings.html` + Android `EmergencyContactsScreen.kt` (built in P1.1) + iOS — add the toggle per-contact
- **Acceptance**: vitest case — invite emergency contact with flag on, remove subject from circle, assert emergency_contact row is gone. With flag off, row persists.

### P3.2 — Snooze management UI
- **Why**: P2.1 ships the snooze API; users also need a single place to see and cancel all active snoozes (otherwise they forget what they muted).
- **Files to modify**:
  - PWA `server/src/public/settings.html` — "Active snoozes" panel listing all snoozes with time-remaining + cancel button
  - Android `AlertSettingsScreen.kt` — same panel
  - iOS MoreTab — same panel
- **Acceptance**: With two active snoozes set, the panel shows both with countdown timers. Tapping cancel removes the snooze immediately.

**Phase 3 verification gate**: vitest + manual smoke on PWA (Android/iOS panels acceptable if Phase 3 time-boxes).

---

## Critical files to read before implementation

- `server/src/scheduler.js` — touched by P1.2, P1.3, P2.1, P2.2, P2.3 (sweep architecture)
- `server/src/fcm.js` — touched by P1.5; gate all P2 push dispatch through it
- `server/src/routes/emergencyContacts.js` — P1.1 + P1.2 + P3.1
- `server/src/routes/alertPrefs.js` — P2.1, P2.3 surface
- `server/src/digest.js` — P2.3 core rewrite
- `android/app/src/main/java/com/familyguardian/data/ApiClient.kt` — P1.1 reuse target
- `android/app/src/main/java/com/familyguardian/ui/PlacesScreen.kt` — P1.1 layout reference
- `android/app/src/main/java/com/familyguardian/ui/AlertSettingsScreen.kt` — P2.1 + P3.2 + P1.1 styling reference
- `ios-app/App.tsx` — P1.4 audio integration site (crash countdown is in the SOS flow, ~line 400)
- `server/migrations/` — sequential numbering; next free is `029`. Allocation: 029–030 in Phase 1, 031 in Phase 1 (FCM meta), 032–033 in Phase 2, 034 in Phase 3.

---

## End-to-end verification

After all phases ship, run this scenario manually across Android + iOS + PWA:

1. **Setup**: 3-user circle (Parent, Teen, Grandparent emergency contact).
2. **P1.1**: Teen invites Grandparent from Android EmergencyContactsScreen → Grandparent accepts on iOS → confirmed visible in PWA settings.
3. **P1.4 + P1.5**: Trigger Teen crash event in dev → audible siren plays on iOS for 30s, push hits Parent's Android via FCM (not just WS).
4. **P1.3**: Restart server while Teen at 8% battery → no duplicate alert when server boots; new alert fires only on next drop.
5. **P1.2**: Grandparent invite generated 8 days ago → not listed; accept attempt returns 410.
6. **P2.1**: Parent snoozes `routine_deviation` for 4h → Teen misses school arrival → no push to Parent, but `alert_events` row written. SOS triggered by Teen still pushes through (cannot snooze SOS).
7. **P2.2**: Three kids all overstay home departure routine in same 60s → Parent receives 1 bundled push, 3 alert rows.
8. **P2.3**: Parent (in `America/New_York`) sets digest to "Saturday 8am ET" → next Saturday at 13:00 UTC, push + WS digest fires.
9. **P3.1** (if shipped): Subject leaves circle with `auto_revoke_on_circle_exit=1` for one contact → that contact's row is gone; other contact (flag off) persists.
10. **P3.2** (if shipped): With two active snoozes, "Active snoozes" panel lists both with countdowns; cancel works.

Run server tests: `cd server && npm test` — expect 59 passing + ~12 new tests added across phases.
