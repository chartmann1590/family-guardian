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

1. Open `android/` in Android Studio (Hedgehog or newer). Let Gradle sync.
2. Run on a device or emulator with location services enabled.
3. On first launch, enter:
   - **Server URL** — `http://10.0.2.2:8080` (Android emulator → host machine) or the LAN IP/HTTPS URL of your server.
   - **Email + password** — the credentials you created during web signup.
4. Grant location + background-location + notification permissions when prompted.
5. The foreground service starts; within ~30s your marker appears on the web dashboard.

## Configuration

| Env var           | Default                | Notes                                      |
| ----------------- | ---------------------- | ------------------------------------------ |
| `PORT`            | `8080`                 | HTTP listen port                           |
| `HOST`            | `0.0.0.0`              | Bind address                               |
| `DATABASE_PATH`   | `/data/guardian.db`    | SQLite file inside the Docker volume       |
| `SESSION_SECRET`  | `change-me-…`          | Cookie signing secret. **Set in prod.**    |
| `LOG_LEVEL`       | `info`                 | Pino log level                             |

### TLS

The container speaks plain HTTP. Put Caddy / nginx / Traefik in front and terminate TLS there. The Android app permits cleartext for the skeleton — switch to HTTPS before you deploy outside your LAN.

## API surface (skeleton)

| Method | Path                          | Auth | Purpose                                       |
| ------ | ----------------------------- | ---- | --------------------------------------------- |
| POST   | `/api/auth/signup`            | —    | Bootstrap admin (first call) or join via code |
| POST   | `/api/auth/login`             | —    | Returns `{token, userId, circleId}`           |
| POST   | `/api/auth/logout`            | ✓    | Destroys session                              |
| GET    | `/api/auth/me`                | ✓    | Current session info                          |
| POST   | `/api/circles/:id/invite`     | ✓    | Admin-only; generate one 8-char code, 24h expiry |
| GET    | `/api/circles/:id/invites`    | ✓    | Admin-only; list outstanding invite codes     |
| DELETE | `/api/invites/:code`          | ✓    | Admin-only; revoke an unused code             |
| POST   | `/api/locations`              | ✓    | Upsert current GPS fix                        |
| GET    | `/api/circles/:id/members`    | ✓    | Roster + last-known location per member       |
| GET    | `/api/circles/:id/places`     | ✓    | List safety places (geofences)                |
| POST   | `/api/circles/:id/places`     | ✓    | Create a geofence                             |
| PATCH  | `/api/places/:id`             | ✓    | Update a geofence                             |
| DELETE | `/api/places/:id`             | ✓    | Delete a geofence                             |
| POST   | `/api/sos/activate`           | ✓    | Trigger an SOS for the current user           |
| POST   | `/api/sos/:id/resolve`        | ✓    | Owner or admin can resolve                    |
| GET    | `/api/circles/:id/sos`        | ✓    | List active SOS events for the circle         |
| GET    | `/ws?token=...`               | ✓    | `location_update`, `geofence_*`, `sos_active`, `sos_resolved` |
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
    routes/               auth, circles, locations, web (HTML), ws
    views/                login.html, dashboard.html (ported from prototypes)
    public/app.js         dashboard client (Leaflet + WS)
    migrations/001_init.sql

android/        Native Kotlin + Jetpack Compose app
  app/src/main/java/com/familyguardian/
    MainActivity.kt
    ui/                   ServerConfigScreen, MapScreen
    data/                 Prefs (DataStore), ApiClient (Retrofit), AuthRepo
    location/             LocationService (foreground), LocationReporter

mobile app/     Original HTML design prototypes (unchanged, reference)
website/        Original HTML design prototypes (unchanged, reference)
```

## What's next

Phase 2 has begun:
- ✅ Safety places / geofences (web + Android) — `places` table, CRUD endpoints, haversine enter/exit detection, live `geofence_enter` / `geofence_exit` events.
- ✅ Invites + multi-member circles — admin Settings page with code generation + revoke + copy-to-clipboard; web login form has a "Join with code" tab; Android sign-in screen has the same.
- ✅ SOS — `sos_events` table, activate/resolve/list endpoints, server falls back to last-known location, web dashboard shows a red top banner + pulsing red map marker for the SOS originator; admin or owner can resolve. Android SOS button fires `/api/sos/activate` with a confirmation dialog and a one-shot high-accuracy fix.
- ✅ Android event stream + system notifications — `EventStreamClient` (OkHttp WebSocket) lives inside the foreground `LocationService`, reconnects with exponential backoff, decodes events into a `GuardianEvent` sealed class, and emits Android notifications: HIGH-priority heads-up for SOS (tap → opens the location in Maps), DEFAULT for geofence arrivals/departures. Self-originated events are filtered out.

Still on the table:
- Family chat (text-only first)
- SOS button — Android side broadcasts + server fan-out
- Member detail / activity timeline (`locations_history` table)
- Server settings + invite UI on the web (currently API-only)
- Profile photos
- HTTPS termination inside the container (optional)
- Push notifications for alerts

Each is a separate prototype already in `website/` and `mobile app/` waiting to be ported.
