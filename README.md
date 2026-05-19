# Family Guardian / GuardianMesh

Self-hosted family safety platform — a Docker-deployed web dashboard plus a native Android app. The server runs on infrastructure you control; location data never leaves your box.

> **Status:** walking skeleton. End-to-end flow works (Android reports GPS → server stores it → web map shows the marker move live). Many screens from the design prototypes are not yet wired up; see "What's next" below.

```
+---------------------------+              +-------------------------+
|  Android app (Kotlin)     |  HTTPS+WS    |  Docker container       |
|  - Server URL + login     |<------------>|  Fastify + SQLite       |
|  - Background GPS         |              |  - REST + WebSocket     |
|  - osmdroid map           |              |  - Serves web dashboard |
+---------------------------+              |  - Volume: /data        |
                                           +-------------------------+
                                                     ^
                                                     | HTTPS
                                                     v
                                           +-------------------------+
                                           |  Web (browser)          |
                                           |  Leaflet + WebSocket    |
                                           +-------------------------+
```

## Quickstart — server

```bash
# from the repo root
docker compose up --build
```

Open <http://localhost:8080>. The very first request brings up a **bootstrap signup** form (one-time, creates the admin and an initial circle). Subsequent visits show the sign-in form.

After signing in you land on `/dashboard` — a Leaflet map with one marker per circle member. Markers move in real time as the Android app reports GPS.

## Quickstart — Android app

You have two options to install the Android app:

**Option A — sideload a pre-built debug APK from your server** (fastest):

```bash
# From the repo root, before `docker compose build`:
cd android && ./gradlew assembleDebug && cd ..
cp android/app/build/outputs/apk/debug/app-debug.apk server/downloads/family-guardian.apk
docker compose up --build
```

Then on the device's browser, open `http://<server-host>:8080/download` and install the APK
(allow "Install from unknown sources" for your browser). The image bakes the APK in at build
time; the server exposes it at `/download/family-guardian.apk`.

**Option B — build and run from Android Studio**:

1. Open `android/` in Android Studio (Hedgehog or newer). Let Gradle sync.
2. Run on a device or emulator with location services enabled.

On first launch, enter:
- **Server URL** — `http://10.0.2.2:8080` (Android emulator → host machine) or the LAN IP/HTTPS URL of your server.
- **Email + password** — the credentials you created during web signup.

Grant location + background-location + notification permissions when prompted.
The foreground service starts; within ~30s your marker appears on the web dashboard.

## Configuration

| Env var           | Default                | Notes                                      |
| ----------------- | ---------------------- | ------------------------------------------ |
| `PORT`            | `8080`                 | HTTP listen port                           |
| `HOST`            | `0.0.0.0`              | Bind address                               |
| `DATABASE_PATH`   | `/data/guardian.db`    | SQLite file inside the Docker volume       |
| `SESSION_SECRET`  | `change-me-…`          | Cookie signing secret. **Required when `NODE_ENV=production`** (server refuses to boot if left as default). |
| `NODE_ENV`        | unset                  | Set to `production` to require `SESSION_SECRET` and mark the session cookie `Secure` (HTTPS only). |
| `LOG_LEVEL`       | `info`                 | Pino log level                             |
| `FCM_SERVICE_ACCOUNT_PATH` | unset        | Path to Firebase service account JSON. When unset, push notifications are disabled. |
| `NOMINATIM_DISABLED` | unset          | Set to `1` to skip reverse-geocoding visits/trips. Labels remain `null`; no outbound HTTP. |
| `NOMINATIM_USER_AGENT` | `family-guardian-selfhosted (…)` | Sent as `User-Agent` to Nominatim. Set to something identifying *your* deployment (Nominatim ToS). |
| `NOMINATIM_URL`      | OSM public Nominatim   | Override to point at a self-hosted Nominatim instance. |

For local dev outside Docker, copy `server/.env.example` to `server/.env`.

### TLS

The container speaks plain HTTP. Put Caddy / nginx / Traefik in front and terminate TLS there. The Android app permits cleartext for the skeleton — switch to HTTPS before you deploy outside your LAN.

### Push notifications (optional)

Family Guardian works without push notifications — the WebSocket connection handles all real-time events while the app is open. Push notifications are only needed when the Android app is killed or in deep sleep.

To enable FCM push notifications:

1. Create a Firebase project at <https://console.firebase.google.com>.
2. Go to **Project Settings → Service Accounts** and generate a new private key JSON file.
3. Set the env var `FCM_SERVICE_ACCOUNT_PATH` to the path of that JSON file (e.g. mount it into the Docker container).
4. Download `google-services.json` from **Project Settings → General → Your apps → Android** and place it at `android/app/google-services.json`.
5. Add the `com.google.gms.google-services` plugin to the Android project's root `build.gradle.kts`:
   ```kotlin
   id("com.google.gms.google-services")
   ```
6. Rebuild the Android app.

Without `FCM_SERVICE_ACCOUNT_PATH`, the server logs "FCM disabled" once and continues normally. All WebSocket features (location updates, SOS, chat, geofences, check-ins) still work.

## API surface (skeleton)

| Method | Path                          | Auth | Purpose                                       |
| ------ | ----------------------------- | ---- | --------------------------------------------- |
| POST   | `/api/auth/signup`            | —    | Bootstrap admin (first call) or join via code |
| POST   | `/api/auth/login`             | —    | Returns `{token, userId, circleId}`           |
| POST   | `/api/auth/logout`            | ✓    | Destroys session                              |
| GET    | `/api/auth/me`                | ✓    | Current session info                          |
| PATCH  | `/api/users/me`               | ✓    | Update display name                           |
| POST   | `/api/users/me/photo`         | ✓    | Upload profile photo (multipart, ≤ 2 MB, JPG/PNG/WebP) |
| DELETE | `/api/users/me/photo`         | ✓    | Remove profile photo                          |
| GET    | `/api/users/:id/photo`        | ✓    | Fetch a circle member's photo                 |
| POST   | `/api/users/me/fcm-token`     | ✓    | Register a Firebase Cloud Messaging token     |
| POST   | `/api/circles/:id/invite`     | ✓    | Admin-only; generate one 8-char code, 24h expiry |
| GET    | `/api/circles/:id/invites`    | ✓    | Admin-only; list outstanding invite codes     |
| DELETE | `/api/invites/:code`          | ✓    | Admin-only; revoke an unused code             |
| POST   | `/api/locations`              | ✓    | Upsert current GPS fix                        |
| GET    | `/api/circles/:id/members`    | ✓    | Roster + last-known location per member       |
| GET    | `/api/circles/:circleId/members/:userId/history` | ✓ | Location history for a member (time-ranged) |
| GET    | `/api/circles/:id/places`     | ✓    | List safety places (geofences)                |
| POST   | `/api/circles/:id/places`     | ✓    | Create a geofence                             |
| PATCH  | `/api/places/:id`             | ✓    | Update a geofence                             |
| DELETE | `/api/places/:id`             | ✓    | Delete a geofence                             |
| POST   | `/api/sos/activate`           | ✓    | Trigger an SOS for the current user           |
| POST   | `/api/sos/:id/resolve`        | ✓    | Owner or admin can resolve                    |
| GET    | `/api/circles/:id/sos`        | ✓    | List active SOS events for the circle         |
| GET    | `/api/circles/:id/messages`   | ✓    | Family chat history (ASC), paginate via `before` + `limit` |
| POST   | `/api/circles/:id/messages`   | ✓    | Send a chat message; broadcasts over WS       |
| POST   | `/api/checkins`              | ✓    | Submit a check-in (safe_home / out_safe / heading_home) |
| GET    | `/api/circles/:id/checkins`  | ✓    | Latest check-ins for the circle             |
| GET    | `/api/circles/:id/visits`    | ✓    | Recent visits (closed stays) across the circle, joined with place names |
| GET    | `/api/circles/:circleId/members/:userId/visits` | ✓ | Per-member visit log, range-filtered |
| GET    | `/api/circles/:circleId/members/:userId/trips`  | ✓ | Per-member trip log (driving/walking segments) |
| GET    | `/api/users/me/alert-prefs`  | ✓    | Read the caller's alert thresholds          |
| PATCH  | `/api/users/me/alert-prefs`  | ✓    | Update speeding/low-battery/offline alert prefs |
| GET    | `/api/circles/:id/alerts`    | ✓    | Recent `alert_events` for the circle (speeding/low_battery/offline) |
| GET    | `/ws`                         | ✓    | WebSocket upgrade (auth via cookie or `Authorization: Bearer`); emits `location_update`, `geofence_*`, `sos_active`, `sos_resolved`, `chat_message`, `check_in` |
| GET    | `/member/:userId`             | cookie | Web member detail page with route history      |
| GET    | `/welcome`                    | cookie | Post-signup wizard: display name + photo + first invite |
| GET    | `/healthz`                    | —    | Liveness probe                                |

Auth is opaque bearer tokens (Authorization header for the mobile app, HttpOnly cookie for the web).

## Repo layout

```
server/         Node.js + Fastify backend (Docker image)
  src/
    index.js              bootstrap
    db.js                 SQLite + migrations
    auth.js               argon2id + sessions
    hub.js                WebSocket pub/sub
    geofence.js           haversine enter/exit detection
    routes/               auth, checkins, circles, locations, messages, places, profile, sos, web, ws
    views/                login.html, dashboard.html, chat.html, places.html, settings.html, member.html
    public/app.js         dashboard client (Leaflet + WS)
    public/chat.js        chat client
    public/places.js      places editor client
    public/settings.js    settings/invite client
    public/member.js      member detail + history client
    migrations/001_init.sql through 007_checkins.sql

android/        Native Kotlin + Jetpack Compose app
  app/src/main/java/com/familyguardian/
    MainActivity.kt
    ui/                   ServerConfigScreen, MapScreen, ChatScreen, PlacesScreen, MemberDetailScreen
    data/                 Prefs, ApiClient, AuthRepo, ChatRepo, CheckinRepo, PlacesRepo, SosRepo, HistoryRepo, ProfileRepo, Models
    location/             LocationService (foreground), LocationReporter
    events/               EventStreamClient, GuardianEvent, EventBus, Alerts

mobile app/     Original HTML design prototypes (unchanged, reference)
website/        Original HTML design prototypes (unchanged, reference)
```

## What's next

All core features are shipped:
- ✅ Safety places / geofences (web + Android) — `places` table, CRUD endpoints, haversine enter/exit detection, live `geofence_enter` / `geofence_exit` events.
- ✅ Invites + multi-member circles — admin Settings page with code generation + revoke + copy-to-clipboard; web login form has a "Join with code" tab; Android sign-in screen has the same.
- ✅ SOS — `sos_events` table, activate/resolve/list endpoints, server falls back to last-known location, web dashboard shows a red top banner + pulsing red map marker for the SOS originator; admin or owner can resolve. Android SOS button fires `/api/sos/activate` with a confirmation dialog and a one-shot high-accuracy fix.
- ✅ Android event stream + system notifications — `EventStreamClient` (OkHttp WebSocket) lives inside the foreground `LocationService`, reconnects with exponential backoff, decodes events into a `GuardianEvent` sealed class, and emits Android notifications: HIGH-priority heads-up for SOS (tap → opens the location in Maps), DEFAULT for geofence arrivals/departures. Self-originated events are filtered out.
- ✅ Family chat — `messages` table, POST/GET endpoints, `chat_message` WS events, web chat page, Android chat screen with day headers and live WS feed.
- ✅ Location history + member details — `locations_history` table (append-only alongside the upsert `locations` table), `GET /api/circles/:id/members/:userId/history` with time-range filtering, web member detail page at `/member/:userId` with Leaflet path polyline + time range selector + device health stats, Android `MemberDetailScreen` with osmdroid path rendering and range selector.
- ✅ Profile photos — upload/display on web dashboard, chat, and Android.
- ✅ Onboarding wizard — post-signup photo + display name + invite generation.
- ✅ Kid's check-in — one-tap status signals (safe at home / out & safe / heading home) on web and Android.
- ✅ Open source readiness — AGPLv3 license, CI (GitHub Actions), test suite (vitest), ESLint + Prettier.

Recently added (movement + insights):
- ✅ **Movement detection** — Android uses the Activity Recognition API with a speed-threshold fallback to label every fix as `still / walking / running / cycling / driving`. Persisted on `locations` + `locations_history`; surfaced as an icon + label on the dashboard and a coloured polyline (red = driving, green = walking, grey = stationary) on the member page.
- ✅ **Speed display in mph or km/h** — both web and Android pick the unit from the device/browser locale (`en-US` → mph, anything else → km/h). See `server/src/public/units.js` and `android/.../ui/Units.kt`.
- ✅ **Visits + dwell duration** — server keeps an in-memory live-visit cache (`server/src/visits.js`) backed by a `visits` table; a stay is closed when the user moves consistently for ~2 fixes. Known places (geofences) are linked via `place_id`; auto-detected stays get reverse-geocoded labels via Nominatim. Browse a member's last 7 days of visits on the Android **Visits** screen or the **Visits** tab on `/member/:id`.
- ✅ **Trip summaries** — every moving segment is captured in a `trips` table with distance, max/avg speed, and a `driving / walking / running / cycling / mixed` mode pulled from the activity stream. Trips appear on the same Android screen and the **Trips** tab.
- ✅ **Speeding alert** — fires (with 5-min debounce) when a driving user crosses the configurable `speeding_threshold_mps` (default ~70 mph). WS event `speeding_alert` + system notification.
- ✅ **Low-battery alert** — fires on the falling-edge crossing of the threshold (default 15%). WS event `low_battery_alert`.
- ✅ **Offline / stale alert** — a 60s scheduler scans `locations` and fires `offline_alert` for users who haven't reported in `offline_minutes` (default 30).
- ✅ **Per-user alert preferences** — every alert type can be toggled and its threshold tuned from the Android **Alert settings** screen (`PATCH /api/users/me/alert-prefs`).

Privacy notes:
- Reverse geocoding hits the public OSM Nominatim service. Each lookup is rate-limited (≤1 req/sec) and cached in `geocode_cache`, but if you'd rather keep all addresses local set `NOMINATIM_DISABLED=1` (or point `NOMINATIM_URL` at your own Nominatim instance). When disabled, visits keep a `lat,lng` label only.
- Android needs the `ACTIVITY_RECOGNITION` runtime permission for activity detection. Denial is non-fatal — the server falls back to inferring `walking / driving` from the GPS speed.

Still on the table:
- FCM push notifications (optional) — would allow notifications when the Android app is killed
- HTTPS termination inside the container (optional)

---

## ☕ Support the Project

If Family Guardian is useful to your family, consider buying the developer a coffee — it helps cover server costs and fuels new features.

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat-square&logo=buy-me-a-coffee&logoColor=white&labelColor=FFDD00)](https://buymeacoffee.com/charleshartmann)

