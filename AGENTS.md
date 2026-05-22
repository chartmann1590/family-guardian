# AGENTS.md — Family Guardian

Self-hosted family safety platform. Walking skeleton: Android reports GPS → Fastify server stores it → web dashboard shows markers moving live via WebSocket.

## Commands

```bash
# Server (from repo root)
docker compose up --build       # full stack, port 8080

# Server (from server/, local dev)
npm run dev                     # node --watch src/index.js (needs Node >= 20)

# Android
# Open android/ in Android Studio (Hedgehog+). Let Gradle sync. Run on device/emulator.
```

No linter or formatting config. Test suite: `npm test` from `server/` (vitest, in-memory SQLite). CI: `.github/workflows/server-ci.yml`.

## Repo layout

```
server/             Fastify + SQLite backend (Docker image)
  src/
    index.js        entrypoint, plugin registration
    db.js           SQLite + auto-run migrations from src/migrations/
    auth.js         argon2id hashing, session tokens, requireAuth hook
    hub.js          in-memory WebSocket pub/sub keyed by circleId
    routes/         auth, circles, locations, messages, places, placeSubscriptions, reactions, pause, sos, checkins, visits, trips, alertPrefs, ws, web, account, download, drivingScore, crashEvents
    views/          login.html, dashboard.html, chat.html, places.html, member.html, settings.html (custom {{KEY}} template engine)
    public/app.js   dashboard client (Leaflet + WebSocket)
    public/chat.js  chat client with reactions, attachments, typing, read receipts
    public/places.js places client with subscription UI
    migrations/     001_init.sql through 020_crash_events.sql

android/            Kotlin + Jetpack Compose app (minSdk 26, compileSdk 34)
  app/src/main/java/com/familyguardian/
    MainActivity.kt, ui/, data/, location/

mobile app/         Static HTML design prototypes (Tailwind CDN) — reference only
website/            Static HTML design prototypes (Tailwind CDN) — reference only
```

## Server specifics

- **ESM only** (`"type": "module"` in package.json). All local imports use `.js` extensions.
- **SQLite** via better-sqlite3. WAL mode + foreign keys on by default. DB file is auto-created at `DATABASE_PATH` (default `/data/guardian.db` inside container).
- **Migrations** auto-run on startup from `server/src/migrations/`. New SQL files are applied in lexical order, tracked in `_migrations` table. Each runs in a transaction.
- **Auth**: first user = bootstrap admin (auto-creates a circle). After that, joining requires an invite code. Passwords hashed with argon2id. Sessions are opaque random tokens stored in `sessions` table, served as `fg_session` HttpOnly cookie (web) or `Authorization: Bearer` header (Android).
- **WebSocket** at `/ws?token=...` or uses cookie auth. Subscribes to one circle; receives `location_update`, `geofence_enter`, `geofence_exit`, `chat_message`, `reaction_added`, `reaction_removed`, `sos_active`, `sos_resolved`, `check_in`, `pause_changed`, `visit_end`, `trip_end`, `chat_typing`, `message_read`, `crash_pending`, `driving_score_updated` JSON events. `sos_active` now carries an optional `source: 'user' | 'crash'` field — set to `'crash'` when the SOS originated from automatic crash detection.
- **Views**: minimal `{{KEY}}` / `{{{KEY}}}` replacement (HTML-escaped / raw). Templates cached in memory after first read.
- **Docker**: multi-stage Node 20 Alpine build. `argon2` needs `python3 make g++ libstdc++` at install time (already in Dockerfile). Volume at `/data` for the SQLite file.

### Env vars

| Var | Default | Note |
|---|---|---|
| `PORT` | `8080` | |
| `HOST` | `0.0.0.0` | |
| `DATABASE_PATH` | `<repo>/server/data/guardian.db` | `/data/guardian.db` in container |
| `SESSION_SECRET` | `change-me-in-production-please` | Set for prod |
| `LOG_LEVEL` | `info` | Pino levels |

## Android specifics

- **Kotlin 2.0.20**, Compose BOM 2024.09.03, Compose plugin enabled.
- **Retrofit** + `kotlinx-serialization-json` for API (no Gson/Moshi). Uses `retrofit2-kotlinx-serialization-converter`.
- **osmdroid** for map (not Google Maps SDK).
- **DataStore Preferences** for persistent storage (server URL, auth token).
- **Foreground service** (`LocationService`) for background GPS reporting.
- `usesCleartextTraffic="true"` in manifest — skeleton allows HTTP. Switch to HTTPS before deploying outside LAN.
- Android emulator connects to host server at `http://10.0.2.2:8080`.

## Design prototypes (`mobile app/`, `website/`)

Static reference-only prototypes. Not part of any build.

- Each `code.html` is self-contained: Tailwind CDN, Inter font, Material Symbols.
- Tailwind config embedded inline under `<script id="tailwind-config">` with design tokens injected as custom colors/spacing.
- Design systems documented in `mobile app/family_guardian/DESIGN.md` and `website/sentinel_core/DESIGN.md` (YAML frontmatter + prose).
- When creating new prototype screens, copy an existing `code.html` from the same product to inherit the correct config.
- Mobile folders use **snake_case**. Website folders are prefixed **`guardianmesh_`** (except `sentinel_core`).
