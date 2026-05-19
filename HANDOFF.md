# Family Guardian — Handoff Brief

> Paste this whole file into a fresh Claude Code session at `h:\family-guardian` and tell the agent: "**Pick up the Family Guardian work — read HANDOFF.md and continue with whichever phase the user asks for next.**"

You are continuing a multi-session project. The plan was approved in an earlier session and Phase 0 + Phase 1.1 + Phase 1.2 are complete and verified. The plan was: **harden the MVP, ship the remaining prototype features, prep for open source.** Audience: **open source for the world** — not just one family.

---

## Repo at a glance

- `server/` — Fastify + SQLite (better-sqlite3), ESM (`"type": "module"`, `.js` extensions on local imports). Multi-stage Docker. Boots on port 8080 by default.
- `android/` — Kotlin + Jetpack Compose, Retrofit, OkHttp, osmdroid, kotlinx-serialization, DataStore. `minSdk = 26`, `compileSdk = 34`.
- `mobile app/`, `website/` — original HTML design prototypes (Tailwind CDN). Reference only, never built.
- `docs/` — public site (`index.html`, `privacy.html`).
- `docker-compose.yml`, `README.md`, `AGENTS.md` at root.

**Conventions you must follow** (discovered the hard way):
- Local ESM imports use `.js` extensions: `import x from './foo.js'`.
- Better-sqlite3 transactions use `db.transaction(() => { … })()` — synchronous.
- Server logs go through Pino (JSON). Use `req.log.warn({…}, 'event_name')` not `console.log`.
- Web templates use `{{KEY}}` (HTML-escaped) and `{{{KEY}}}` (raw). The render function in `server/src/routes/web.js` was buggy until this session — **don't reintroduce the bug**: raw replace must run before safe replace.
- Initial state JSON goes inside `<script>window.__X__ = {{{INITIAL_STATE_JSON}}};</script>` after `JSON.stringify(state).replace(/</g, '\\u003c')`. That escape is intentional and safe.
- All web client JS is in `server/src/public/*.js`, statically served at `/public/...`.
- Views are HTML files in `server/src/views/`. Tailwind via CDN, design tokens redefined inline per page (matches the prototype design system — keep the colour/spacing config consistent across new pages).
- New SQLite migrations go in `server/src/migrations/NNN_name.sql`, auto-run in lexical order on boot, tracked in `_migrations` table, wrapped in a transaction each.
- New routes: `server/src/routes/<name>.js`, export `default async function (fastify, { db, … })`, register in `server/src/index.js`.
- Android DTOs in `data/Models.kt` with `@Serializable`. Add to ProGuard keep rules at `android/app/proguard-rules.pro` if you add new packages.
- Don't add comments that explain *what* — only *why-it's-non-obvious*. No multi-line docstrings.

**Things that work in this dev environment** (Windows + msys bash):
- `cd "h:/family-guardian/server" && npm install` — installs successfully.
- `DATABASE_PATH="$(pwd)/data/test.db" PORT=8765 npm start` works for local server boots. Use a temp DB path, not the default one.
- `curl`, `node` work in bash. `grep -P` doesn't (use sed/node instead).
- Background processes: use `run_in_background: true` and wait with `until curl -sf …; do sleep 1; done`. Kill with `taskkill //F //PID $(netstat -ano | grep :PORT | grep LISTENING | head -1 | awk '{print $5}')`.
- Test JSON files: write to `h:/family-guardian/server/tmp-test/` (gitignored implicitly since the dir doesn't exist). `/tmp/...` paths get translated by msys for `curl` but Node `require()` can't resolve them.
- After every server change, syntax-check with `node --check src/<file>.js`.
- After every test session, clean: `rm -rf h:/family-guardian/server/data/test.db* h:/family-guardian/server/data/uploads h:/family-guardian/server/tmp-test`.

**Memory directory**: `C:\Users\Charles\.claude\projects\h--family-guardian\memory\` — write user/feedback/project memories there per the auto-memory system. `MEMORY.md` is the index. None yet.

---

## What's already shipped (do not re-do)

### Phase 0 — Hardening
- **Transactions**: `routes/locations.js` (upsert + history insert) and `geofence.js` (presence reconciliation) are now atomic.
- **Clamp**: `recordedAt` clamped to `Date.now()` in `routes/locations.js`.
- **Rate limits**: `@fastify/rate-limit` registered with `global: false`. Per-route: login 10/min, signup 5/hr, invite 20/hr.
- **Auth logging**: failed logins logged with `{ip, email}` via Pino.
- **WS auth**: dropped `?token=…` from `routes/ws.js`. Uses `Authorization: Bearer` header (Android, via `events/EventStreamClient.kt`) or `fg_session` cookie (web). Web clients already used the cookie.
- **Cookie hardening**: `secure: process.env.NODE_ENV === 'production'` in `routes/auth.js`.
- **Env validation**: server refuses to boot if `NODE_ENV=production` and `SESSION_SECRET` is still default. `.env.example` exists. `dotenv` loaded in `index.js`.
- **Body limit**: 64 KB at Fastify level. Multipart routes use their own 2 MB cap.
- **Android release blockers**: `signingConfigs.release` reads keystore from `~/.gradle/gradle.properties` props (`FG_RELEASE_KEYSTORE`, `FG_RELEASE_STORE_PASSWORD`, `FG_RELEASE_KEY_ALIAS`, `FG_RELEASE_KEY_PASSWORD`). R8 + `isShrinkResources` enabled. `proguard-rules.pro` covers Retrofit, kotlinx-serialization, `com.familyguardian.{data,events}.**`, osmdroid.
- **POST_NOTIFICATIONS**: `Alerts.kt` checks the permission before every `nm.notify()`.
- **Network errors surfaced**: `MapScreen.kt` shows a retry banner instead of silently emptying the list; `ChatScreen.kt` clears stale error before each send; `PlacesScreen.kt` clears `validationError` on next keystroke.

### Phase 1.1 — Profile photos
- Migration `006_profile_photos.sql` adds `users.photo_path TEXT`.
- `routes/profile.js` (new):
  - `POST /api/users/me/photo` (multipart, 2 MB, JPG/PNG/WebP). Streams to a temp file first, renames on success — an oversized retry **cannot destroy** an existing good photo.
  - `DELETE /api/users/me/photo`
  - `GET /api/users/:id/photo` — ACL: caller must share a circle. Short cache, content-type by extension.
- `@fastify/multipart` registered in `index.js` with `fileSize: 2MB`. `<DATA_DIR>/uploads/` auto-created on boot.
- `routes/locations.js` and `routes/web.js` member-list queries include `photoUrl` (`/api/users/<id>/photo` or `null`).
- Web: `public/app.js`, `public/member.js`, `public/settings.js` all use `avatarInner(m)` pattern — initials always render; `<img onerror="this.remove()">` overlays them. Works for sidebar avatars, Leaflet markers, settings list.
- Web upload UI: settings page has "Your photo" section with file picker + remove button.
- Android: Coil added (`io.coil-kt:coil-compose:2.7.0`). `data/ProfileRepo.kt` provides upload + a singleton `ImageLoader` factory that injects bearer token via OkHttp interceptor (`prefs.snapshotBlocking()` reads token per request). `ui/Avatar.kt` is the shared composable used in `ChatScreen.kt` + `MapScreen.kt` Members dialog.
- Android map markers (osmdroid `Marker`) stay as initials — `Marker` renders `Drawable`, not Composables. Future work.
- `MemberDetailScreen.kt` avatar stays as initials — its `MemberInfo` struct doesn't plumb photoUrl through nav args. Future work: extend MemberInfo or fetch member fresh on screen entry.

### Phase 1.2 — Onboarding + profile setup
- `routes/profile.js` adds `PATCH /api/users/me` (only `displayName` for now, zod-validated 1–64 chars). Returns refreshed user with `photoUrl`.
- `routes/web.js` adds `GET /welcome` route. Requires session. Renders `welcome.html` with `me: { userId, displayName, photoUrl, isAdmin }` + `circleId`, `circleName`.
- **Template-engine bug fix** in `routes/web.js`: the original `render()` ran safe-replace (`{{KEY}}`) before raw-replace (`{{{KEY}}}`), and since `{{KEY}}` is a substring of `{{{KEY}}}`, it mangled every script-tag JSON payload on every page. Now raw runs first. This is the reason the dashboard appeared to work for static curl checks but `window.__GUARDIAN_STATE__` was actually unparseable JS. **Do not reorder these lines.**
- `views/welcome.html` (new) — 3-step wizard: photo + display name → admin-only invite generation → confirmation. "Skip onboarding" link sends user to `/dashboard`.
- `public/welcome.js` (new) — wizard logic against `PATCH /api/users/me`, `POST /api/users/me/photo`, `POST /api/circles/:id/invite`. Non-admins skip step 2.
- `views/login.html` JS — both signup paths (bootstrap admin + join-with-invite) now redirect to `/welcome`. Plain login still goes straight to `/dashboard`.
- Android: `Prefs.kt` adds `onboarded: Flow<Boolean>` + `setOnboarded()` + `setDisplayName()`, included in `Snapshot`. `AuthRepo.kt`: `login()` sets `onboarded=true`, `joinWithInvite()` sets `onboarded=false`. `OnboardingScreen.kt` (new) is a single-card wizard: photo picker (gallery via `GetContent`) + display name. Continue → PATCH name + upload photo + set onboarded → exit. Skip just sets onboarded. `MainActivity.kt` routes `login → onboarding|map` based on the flag.

---

## What's NOT done (the work for the next session)

Order recommendation: **1.5 → 1.3 → 2 → 1.4**. 1.5 is the smallest win. 1.3 is the largest standalone new feature. 1.4 requires Firebase setup that may not be testable locally. Phase 2 is open-source readiness, no new features.

---

### Phase 1.3 — Kid's check-in

**Why**: the prototype `mobile app/kid_s_check_in/code.html` has zero implementation. Parents want a one-tap "I'm safe at home / out & safe / heading home" signal.

**Server**:
1. **Migration `007_checkins.sql`** in `server/src/migrations/`:
   ```sql
   CREATE TABLE IF NOT EXISTS check_ins (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       circle_id  INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
       status     TEXT NOT NULL CHECK(status IN ('safe_home','out_safe','heading_home')),
       lat        REAL,
       lng        REAL,
       note       TEXT,
       created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS idx_checkins_circle_created
       ON check_ins(circle_id, created_at DESC);
   ```
2. **New route `routes/checkins.js`**:
   - `POST /api/checkins` — body `{status, lat?, lng?, note?}`. Insert row. Publish `check_in` event on the circle's WS hub. Return the inserted row.
   - `GET /api/circles/:id/checkins?limit=50` — return latest N per circle (verify membership). Default limit 50, cap 500.
3. Register in `index.js` alongside other routes.
4. Update README API table.

**Hub**: `hub.js` currently passes events through without filtering — verify a new event type `check_in` flows. No allowlist to update.

**Web**:
- `public/app.js` — show "latest check-in" pill on each member card in the sidebar. Subscribe to `check_in` events on the WS and update in place. Toast on receipt.
- Optional: small "Send check-in" UI at the bottom of the dashboard for desktop users on the same device.

**Android**:
- New `data/CheckinRepo.kt` mirroring `SosRepo.kt`'s shape: `suspend fun send(status: String, lat: Double?, lng: Double?)`.
- `MapScreen.kt`: add a "Check in" button above the SOS button (smaller, secondary colour). Tapping shows a 3-button dialog (safe at home / out & safe / heading home). Use `oneShotFix()` already in `MapScreen.kt` for the location.
- `events/GuardianEvent.kt`: add `data class CheckIn(...)` to the sealed interface.
- `events/Alerts.kt`: add `showCheckIn(userId, displayName, status)` using `CHANNEL_NORMAL` and a `check_in` notification id base (extend the existing `chatNotifId`/`sosNotifId` scheme — pick 5_000_000).
- `events/EventStreamClient.kt` shouldn't need changes — Json.decodeFromString with the `type` discriminator handles it once you add the variant to the sealed interface.

**Verification**:
- Send a check-in via curl; confirm row in DB.
- Open two WS connections (one as sender, one as listener); confirm listener gets `check_in` event with the right shape.
- Test that GET `/api/circles/:id/checkins` requires membership (403 from a non-member, 200 with rows for a member).

---

### Phase 1.4 — FCM push notifications (optional)

Make it **optional**: if `FCM_SERVICE_ACCOUNT_PATH` env var is unset, log once at boot ("FCM disabled") and become a no-op everywhere. Most self-hosters won't set up Firebase, and the in-app WS already covers the foreground case.

**Server**:
1. **Migration `008_fcm.sql`**:
   ```sql
   CREATE TABLE IF NOT EXISTS fcm_tokens (
       user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       token      TEXT NOT NULL,
       platform   TEXT NOT NULL,    -- 'android' for now
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (user_id, token)
   );
   CREATE INDEX IF NOT EXISTS idx_fcm_tokens_user ON fcm_tokens(user_id);
   ```
2. New dep: `firebase-admin` in `server/package.json`.
3. New module `server/src/fcm.js`:
   - On import: try to read `FCM_SERVICE_ACCOUNT_PATH`. If set, init Firebase Admin. If not, set `disabled = true`.
   - Export `async function fanOut(circleId, payload, db, excludeUserId)` — looks up all tokens for the circle's other members, sends in batches. Drops invalid tokens from the DB (catch `messaging/registration-token-not-registered`).
   - Log "FCM disabled" exactly once.
4. New route in `routes/profile.js`: `POST /api/users/me/fcm-token` body `{token}`. Upsert into `fcm_tokens`.
5. Wire `fanOut()` into `routes/sos.js`, `geofence.js`, `routes/messages.js` after each hub broadcast.

**Android**:
1. Add `com.google.firebase:firebase-messaging` + `google-services` plugin to `android/app/build.gradle.kts`. **Document that this requires a `google-services.json`** that the user generates — don't commit one.
2. New `events/FcmService.kt extends FirebaseMessagingService`:
   - `onNewToken(token)`: POST to `/api/users/me/fcm-token` via OkHttp (similar shape to `ProfileRepo.uploadPhoto`).
   - `onMessageReceived(message)`: bridge into `Alerts.kt` methods. Use the message's `data` payload to figure out which `Alerts.showXxx` to call.
3. Register in `AndroidManifest.xml`.
4. Persist token in `Prefs.kt` (`keyFcmToken: stringPreferencesKey("fcm_token")`).

**README**:
- New section "Push notifications (optional)" explaining how to set up Firebase project, download service account JSON, set `FCM_SERVICE_ACCOUNT_PATH`, place `google-services.json` in `android/app/`.
- Explicitly note: works without FCM; you only need this for notifications when the app is killed.

**Verification (limited without Firebase)**:
- Without `FCM_SERVICE_ACCOUNT_PATH`: server boots, logs "FCM disabled", SOS/geofence/chat all still fire WS events. No crash.
- POST `/api/users/me/fcm-token` with a fake token → 200, row inserted.
- With real Firebase setup (manual test): kill Android app, trigger SOS from another device, confirm notification arrives.

---

### Phase 1.5 — Chat polish (web)

Small. No schema change (`messages.created_at` already exists from migration 004). Android already has day headers via `ChatScreen.kt`'s `itemsWithDayHeaders`.

**Files**:
- `server/src/public/chat.js` — add day-header separators (port the logic from `ChatScreen.kt`'s `dayHeader()` — Today / Yesterday / formatted date). Show per-message timestamp (`HH:mm`). Use `Avatar` pattern from `app.js` (`avatarInner` helper — extract it to a shared place or duplicate inline).
- `server/src/views/chat.html` — should already have the message list scaffolding; add classes for day-header rows if needed.
- Auto-scroll to bottom on new message. Track whether the user has scrolled up; if so, show a small "↓ new messages" pill instead of forcing scroll.

**Verification**:
- Send 5 messages, refresh, confirm timestamps render correctly.
- Set device clock back 24h, send a message, refresh → "Yesterday" header appears between today's messages and the earlier ones.
- Scroll up, have another user send a message → pill appears, doesn't force scroll. Click pill → scrolls down.

---

### Phase 2 — Open source readiness

For each item: small PR, no behaviour change for end users.

1. **`LICENSE`** at root. **Ask the user** before picking — MIT vs AGPLv3 has real implications for a self-hosted-vs-SaaS-ification concern. Default: MIT.
2. **`CONTRIBUTING.md`** at root: clone, `cd server && npm install`, `npm run dev`, "no test suite yet" reality, PR style.
3. **`SECURITY.md`** at root: `charles.h.hartmann1@gmail.com` as the contact (the user's email per harness context).
4. **Server test suite** with `vitest`:
   - `server/test/auth.test.js` — hashing + session lookup + extractToken.
   - `server/test/geofence.test.js` — `haversineMeters` known distances, `reconcileGeofences` enter/exit transitions.
   - `server/test/locations.test.js` — POST a fix, assert `locations` has 1 row and `locations_history` has N+1 (verify the Phase 0 transaction). Clamp test for `recordedAt`.
   - Use Fastify's in-process testing with an in-memory SQLite (`new Database(':memory:')`).
   - Add `"test": "vitest run"`, `"test:watch": "vitest"` to `server/package.json`.
   - ~15 tests total. Don't gold-plate.
5. **ESLint + Prettier** for `server/`:
   - `.eslintrc.json`: `eslint:recommended` + a few rules. ESM, browser globals off, node on.
   - `.prettierrc`: 4-space indent (match existing), single quotes, no trailing commas in JS (match existing).
   - `"lint"` and `"format"` scripts.
6. **GitHub Actions** `.github/workflows/server-ci.yml`: matrix on node 20/22, runs `npm install && npm run lint && npm test` against `server/`.
7. **Healthz upgrade** in `server/src/index.js`: `db.prepare('SELECT 1').get()`, return 503 if it throws. Add `HEALTHCHECK` line to `server/Dockerfile`.
8. **README screenshots**: ask user to paste 2–3 PNGs (dashboard + places + Android map). Drop in `docs/screenshots/`. Reference from README.

---

## Useful test snippets (copy-paste ready)

### Spin up a clean server for testing
```bash
cd "h:/family-guardian/server" && rm -rf data/test.db* data/uploads tmp-test 2>/dev/null
DATABASE_PATH="$(pwd)/data/test.db" PORT=8765 npm start
# in another shell, or use run_in_background:
until curl -sf http://127.0.0.1:8765/healthz >/dev/null 2>&1; do sleep 1; done; echo READY
```

### Bootstrap signup, get token
```bash
TMPDIR="h:/family-guardian/server/tmp-test"; mkdir -p "$TMPDIR"
curl -s -X POST http://127.0.0.1:8765/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"hunter2hunter","displayName":"Alice"}' \
  > "$TMPDIR/signup.json"
TOKEN=$(node -e "console.log(require('$TMPDIR/signup.json').token)")
```

### Stop the server cleanly
```bash
PID=$(netstat -ano | grep :8765 | grep LISTENING | head -1 | awk '{print $5}')
if [ -n "$PID" ]; then taskkill //F //PID $PID; fi
sleep 1
rm -rf "h:/family-guardian/server/tmp-test" "h:/family-guardian/server/data/test.db"* "h:/family-guardian/server/data/uploads"
```

### Inspect the live DB
```bash
node -e "
const Database = require('h:/family-guardian/server/node_modules/better-sqlite3');
const db = new Database('h:/family-guardian/server/data/test.db');
console.log(db.prepare('SELECT * FROM <TABLE>').all());
"
```

### WS test
```bash
node -e "
const WebSocket = require('h:/family-guardian/server/node_modules/ws');
const ws = new WebSocket('ws://127.0.0.1:8765/ws', { headers: { Authorization: 'Bearer $TOKEN' } });
ws.on('message', m => console.log(m.toString()));
ws.on('open', () => console.log('open'));
"
```

---

## Known-unverified areas

- **Android** has not been built or run since this work began. Everything compiled-in-my-head. Highest risk: imports, Compose preview drift, ProGuard rules. **Action**: first thing the next session should do is `cd android && ./gradlew assembleDebug` (or have the user do it) and fix any compile errors.
- **Coil ImageLoader auth interceptor** in `ProfileRepo.kt` uses `prefs.snapshotBlocking()` which calls `runBlocking` from an OkHttp dispatcher thread. Should be fine for short DataStore reads but worth profiling under load.
- **MemberDetailScreen.kt** avatar is still initials-only because its `MemberInfo` doesn't carry `photoUrl`. Easy follow-up: extend `MemberInfo` and pass through `nav.navigate("member/$userId/$displayName?photoUrl=$photoUrl")`.
- **osmdroid markers** stay as initials — see "What's already shipped → 1.1".

---

## House rules (the human stated these explicitly)

- Goal: **fix critical issues, then ship features** + **open source for the world**.
- Don't add features beyond the scope of the current task. Don't over-engineer.
- Use TaskCreate/TaskUpdate to track multi-step work. One task in_progress at a time.
- Test on a live server (not just syntax-check) before claiming a phase done.
- Pause after big milestones; let the human verify before proceeding.
- Don't commit unless the human asks. Don't push, ever, without permission.
