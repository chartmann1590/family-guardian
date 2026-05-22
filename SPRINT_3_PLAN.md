# Sprint 3 — Chat Polish (B1–B4)

## Context

Sprints 1 (Privacy & Control) and 2 (Smart Notifications + Reactions) are shipped, with 59 vitest tests passing. The next theme on the roadmap in `NEXT_SPRINT_PROMPT.md` is **chat polish**: voice notes, photo attachments, photo check-ins, typing indicators, and read receipts. Sprint 3 takes the chat surface from "text + reactions" to a fully expressive family chat without compromising the privacy-first stance established in Sprint 1.

Scope confirmed by maintainer: full B1–B4 on all four surfaces (server, PWA, Android, iOS), with read receipts opt-in by default.

---

## Build order and ship gates

Strict order: **B1 → B2 → B3 → B4**. Each sub-feature is independently mergeable. Pause for human verification at every checkpoint.

| Phase | Feature | Migration | New tests |
|---|---|---|---|
| B1 | Voice + photo notes in chat | `016_message_attachments.sql` | `server/test/messages_attachment.test.js` |
| B2 | Photo check-ins | `017_checkin_photos.sql` | `server/test/checkin_photo.test.js` |
| B3 | Typing indicators | _(none — WS-only)_ | `server/test/typing.test.js` |
| B4 | Read receipts (opt-in) | `018_message_reads.sql` | `server/test/read_receipts.test.js` |

---

## Locked-in design decisions

1. **Attachment storage:** `<UPLOADS_DIR>/messages/<circleId>/<messageId>.<ext>` (per-circle subdir for future quota/wipe-on-leave).
2. **One migration per feature** so partial ships are clean. B3 has no migration (don't create an empty file).
3. **Send-with-attachment** = single multipart POST that combines body + file. Mirrors `POST /api/users/me/photo`.
4. **EXIF stripping** = pure-JS JPEG-only strip in new `server/src/exifStrip.js`. PNG/WebP passed through unchanged. No `sharp` dependency. (Privacy risk is JPEG-specific — most cameras + iOS Photos.)
5. **Audio mime allowlist** = `audio/mp4`, `audio/aac`, `audio/m4a`, `audio/x-m4a`, **plus `audio/webm`** for Safari PWA fallback. Safari's `MediaRecorder` defaults to webm/opus.
6. **Read-receipts opt-in flag** = new column `users.read_receipts_enabled INTEGER NOT NULL DEFAULT 0`. Default OFF preserves privacy on upgrade. No generic prefs table (premature).
7. **Read-receipts mutual gate** = receipts only written when **both** message author AND reader have the flag ON at the time of read POST. Either side opted out → silent 204. (Signal model.)
8. **Author-only visibility** = `readers: [...]` is attached only to messages the requester authored. Other people's messages never expose a viewer list, regardless of settings.
9. **Read endpoint = batch only** (`POST /api/messages/read-batch` body `{messageIds: number[]}`, max 50). Single endpoint avoids dual code paths.
10. **Typing rate-limit** = server caps at 60/min; client debounces to one ping per 3s of active typing. FCM fan-out **skipped** for typing.
11. **iOS file structure** = keep single-file `App.tsx` for this sprint. Refactor into `screens/` can be a Sprint 4 cleanup task.

---

## Server changes

### B1 — Voice + photo attachments

**New helpers**
- `server/src/exifStrip.js`
  - `stripJpegExif(buffer)` — walks JPEG markers, removes APP1 (0xFFE1) and APP2 (0xFFE2) segments.
  - `stripImageMetadata({buffer, mime})` — switches on mime; jpeg → strip, png/webp → pass-through.
  - `isAllowedImageMime(mime)`, `isAllowedAudioMime(mime)` predicates.
- `server/src/uploads.js` (extract the temp-file pattern from `routes/profile.js` lines 60–87 so B1, B2, and the existing photo upload share it).
  - `streamToTemp(file, uploadsDir)` → `{tmpPath, truncated}`.
  - `commitAttachment({tmpPath, finalPath, transform})` — runs optional transform (EXIF strip on buffer), atomic rename.

**Migration `016_message_attachments.sql`**
```sql
ALTER TABLE messages ADD COLUMN attachment_kind TEXT
    CHECK(attachment_kind IS NULL OR attachment_kind IN ('audio','image'));
ALTER TABLE messages ADD COLUMN attachment_path TEXT;
ALTER TABLE messages ADD COLUMN attachment_mime TEXT;
ALTER TABLE messages ADD COLUMN attachment_bytes INTEGER;
ALTER TABLE messages ADD COLUMN attachment_duration_ms INTEGER;
```

**Routes** (modify `server/src/routes/messages.js`)
- `POST /api/circles/:id/messages/attachment` (multipart) — field `file`, field `kind` ∈ {`audio`,`image`}, optional field `body` (≤2000 chars).
  - Validate mime against kind. Reject `unsupported_type` / `too_large`.
  - Image → EXIF-strip via helper.
  - Insert row with NULL path → write file with `lastInsertRowid` as filename → UPDATE path. Try/catch deletes row + unlinks tmp on failure (better-sqlite3 transactions are sync, can't wrap async file IO).
  - Rate limit: 20/min.
  - Publish `chat_message` WS event with `attachmentUrl`, `attachmentKind`, `attachmentMime`. Call `fanOut()` (FCM) as today.
- `GET /api/messages/:id/attachment` — ACL via circle membership. `createReadStream()`, content-type from `attachment_mime`, `Cache-Control: private, max-age=3600`.
- Modify `rowToMsg()` to include attachment fields when present.

### B2 — Photo check-ins

**Migration `017_checkin_photos.sql`**
```sql
ALTER TABLE check_ins ADD COLUMN photo_path TEXT;
```

**Routes** (modify `server/src/routes/checkins.js`)
- Keep existing `POST /api/checkins` (JSON) unchanged for backward compat.
- Add `POST /api/checkins/with-photo` (multipart) — same text fields plus required `photo` file.
  - EXIF-strip, save to `checkins/<checkinId>.<ext>`.
  - Insert row → write file → UPDATE photo_path. Same recovery pattern as B1.
  - Rate limit: 30/hr.
- Add `GET /api/checkins/:id/photo` — ACL via circle membership.
- `rowToJson()` includes `photoUrl` when path present.
- `check_in` WS event payload grows with `photoUrl`. No new event type.

### B3 — Typing indicators

No migration. Modify `server/src/routes/messages.js`:
- `POST /api/circles/:id/typing` — auth + member assertion, look up `displayName`, publish hub event:
  ```js
  {type: 'chat_typing', circleId, userId, displayName, expiresAt: Date.now() + 5000}
  ```
  Return 204. Rate limit: 60/min. **Skip FCM** (presence, not notification).

Hub: no changes (passthrough already handles new types).

### B4 — Read receipts (opt-in)

**Migration `018_message_reads.sql`**
```sql
CREATE TABLE IF NOT EXISTS message_reads (
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    read_at     INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_reads_message ON message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_user    ON message_reads(user_id, read_at DESC);

ALTER TABLE users ADD COLUMN read_receipts_enabled INTEGER NOT NULL DEFAULT 0;
```

**Routes** (modify `server/src/routes/messages.js`)
- `POST /api/messages/read-batch` body `{messageIds: number[]}` (max 50).
  - Auth + circle membership for each id (group by circle_id, one membership check per circle).
  - Self-reads → silent skip (no row, no broadcast).
  - For each (message, reader): single JOIN query checks `author.read_receipts_enabled AND reader.read_receipts_enabled`. If both 1 → `INSERT OR IGNORE`, publish `message_read` event.
  - Rate limit: 120/min.

**Modify `GET /api/circles/:id/messages`**
- Add `?withReaders=1` query flag. Only attach `readers: [{userId, readAt}]` to messages **authored by** the requester. Per-message viewer list is invisible to non-authors regardless of settings.

**Modify `server/src/routes/profile.js`**
- `PATCH /api/users/me` accepts `readReceiptsEnabled?: boolean` (extend `UpdateMeBody` zod schema).
- `GET /api/users/me` returns `readReceiptsEnabled`. Add to login response too so clients know on startup.

---

## Client changes

### PWA (`server/src/public/`)

**B1** — `chat.js`:
- Composer toolbar: image-picker `<input type="file" hidden>` + mic button.
- Recording via `MediaRecorder` with `audio/mp4; codecs=mp4a.40.2` (Chrome/Edge) or `audio/webm; codecs=opus` (Safari fallback).
- `sendAttachment(file, kind, body)` → multipart POST.
- Extend `bubble()`: image → `<img loading="lazy" class="rounded-lg max-w-xs">`; audio → `<audio controls preload="metadata">`.

**B2** — `chat.js` + `app.js`:
- Check-in pill shows photo thumb when `photoUrl` present in `check_in` events.
- `settings.js` or check-in composer view: add file input + preview before send.

**B3** — `chat.js`:
- `typingUsers = new Map<userId, expiresAt>`. WS handler for `chat_typing`. 1s `setInterval` prunes expired entries. DOM line under composer.
- Composer `input` event debounced (3s cooldown) → POST.

**B4** — `chat.js` + `settings.js`:
- `IntersectionObserver` on bubbles; visible non-self ids queued, flushed via `/read-batch` every 2s.
- Owner's own bubbles render "Seen by Alice, Bob" line from `msg.readers`.
- WS `message_read` patches in-memory `readers` for matching owned message.
- `settings.js`: toggle "Read receipts" → `PATCH /api/users/me {readReceiptsEnabled}`. Helper copy: "When ON, people who also enable receipts will see when you've read their messages."

### Android (`android/app/src/main/java/com/familyguardian/`)

**B1**
- `data/Models.kt`: extend `ChatMessage` with `attachmentUrl`, `attachmentKind`, `attachmentMime`, `attachmentDurationMs` (all nullable).
- `data/ChatRepo.kt`: `sendAttachment(circleId, file, kind, body?)` via Retrofit `@Multipart`.
- `ui/ChatScreen.kt`: `MessageBubble` `when (attachmentKind)` branch — image via Coil `AsyncImage` (existing auth interceptor), audio via Compose Box + IconButton wrapping `android.media.MediaPlayer`.
- Composer: attach icon (image picker via `ActivityResultContracts.GetContent("image/*")`), mic icon (press-and-hold via `MediaRecorder` with `MPEG_4` / `AAC`).
- `AndroidManifest.xml`: add `<uses-permission android:name="android.permission.RECORD_AUDIO" />`.

**B2**
- `data/CheckinRepo.kt`: `checkinWithPhoto(...)` multipart variant.
- `data/Models.kt`: `CheckinResponse` and `GuardianEvent.CheckIn` gain `photoUrl: String?`.
- `ui/MapScreen.kt` (or wherever the check-in pill renders): thumb on Coil `AsyncImage`.

**B3**
- `events/GuardianEvent.kt`: add `ChatTyping(circleId, userId, displayName, expiresAt)` sealed case.
- `events/EventStreamClient.kt`: extend `when (type)` switch.
- `data/ChatRepo.kt`: `sendTyping(circleId)`.
- `ui/ChatScreen.kt`: `mutableStateMapOf<Long, Long>` for typing users. `LaunchedEffect` ticks 1Hz to expire entries. Text line under composer. `LaunchedEffect(input)` debounces sends to 3s.

**B4**
- `data/Models.kt`: `MessageReader(userId, readAt)`, `ChatMessage.readers: List<MessageReader>?`, profile DTO gains `readReceiptsEnabled`.
- `data/ChatRepo.kt`: `markRead(messageIds)`, `setReadReceiptsEnabled(enabled)`.
- `events/GuardianEvent.kt`: `MessageRead(messageId, userId, readAt)`.
- `ui/ChatScreen.kt`: track `LazyListState.layoutInfo.visibleItemsInfo`, flush every 2s. Owner's bubbles get "Seen by N" caption.
- `ui/AccountScreen.kt`: toggle for read receipts.

### iOS (`ios-app/`)

**Dependencies** (`package.json`):
- `expo-av` — audio record + play.
- `expo-image-picker` — image selection.
- `expo-file-system` — multipart fetch.

**Permissions** (`app.json` → `infoPlist`):
- `NSMicrophoneUsageDescription`: "Record voice notes in family chat."
- `NSPhotoLibraryUsageDescription`: "Attach photos to chat and check-ins."
- `NSCameraUsageDescription`: "Take a check-in photo."

**`App.tsx`** (single-file, kept as-is for this sprint):
- B1: `recordVoice()` via `Audio.Recording`, `pickImage()` via `ImagePicker.launchImageLibraryAsync`, `sendAttachment()` via `FormData` with file URI. Image bubble = `<Image>`; audio bubble = `expo-av Audio.Sound` with play button.
- B2: Check-in composer adds optional image picker + thumb.
- B3: WS `chat_typing` branch, `typingUsers` state with interval expiry. Composer `onChangeText` debounced typing POST.
- B4: `<FlatList onViewableItemsChanged>` collects visible non-self ids, batched POST every 2s. Settings tab toggle. Owner messages render "Seen by …" line.

---

## Critical files to create / modify

**Created**
- `server/src/migrations/016_message_attachments.sql`
- `server/src/migrations/017_checkin_photos.sql`
- `server/src/migrations/018_message_reads.sql`
- `server/src/exifStrip.js`
- `server/src/uploads.js`
- `server/test/messages_attachment.test.js`
- `server/test/checkin_photo.test.js`
- `server/test/typing.test.js`
- `server/test/read_receipts.test.js`

**Modified**
- `server/src/routes/messages.js` — attachment route, typing route, read-batch route, history `withReaders` flag, `rowToMsg` extension
- `server/src/routes/checkins.js` — `/with-photo` route, `/photo` serve route, `rowToJson` extension
- `server/src/routes/profile.js` — `readReceiptsEnabled` in PATCH + GET responses, login response
- `server/src/index.js` — register new routes (if any are in new files; current plan keeps everything inside existing route files, but verify)
- `server/src/public/chat.js` — composer toolbar, attachment bubbles, typing UI, read-receipt tracker
- `server/src/public/app.js` — check-in photo thumb in dashboard pill
- `server/src/public/settings.js` — read-receipts toggle
- `android/app/src/main/java/com/familyguardian/data/Models.kt` — DTO extensions
- `android/app/src/main/java/com/familyguardian/data/ChatRepo.kt` — new methods
- `android/app/src/main/java/com/familyguardian/data/CheckinRepo.kt` — `checkinWithPhoto`
- `android/app/src/main/java/com/familyguardian/events/GuardianEvent.kt` — `ChatTyping`, `MessageRead`
- `android/app/src/main/java/com/familyguardian/events/EventStreamClient.kt` — new variant decoding
- `android/app/src/main/java/com/familyguardian/ui/ChatScreen.kt` — attachment bubbles, composer toolbar, typing UI, read tracker
- `android/app/src/main/java/com/familyguardian/ui/AccountScreen.kt` — receipts toggle
- `android/app/src/main/AndroidManifest.xml` — `RECORD_AUDIO` permission
- `ios-app/App.tsx` — all four features
- `ios-app/package.json` — `expo-av`, `expo-image-picker`, `expo-file-system`
- `ios-app/app.json` — three permission strings
- `README.md` — Chat section + API additions
- `AGENTS.md` — new tables + WS events
- `NEXT_SPRINT_PROMPT.md` — mark Sprint 3 as shipped

---

## Reused utilities (don't re-invent)

- `requireAuth(db)` prehandler — auth on every new route.
- `db.transaction(() => …)()` — synchronous; do **not** use for file IO.
- `streamToTemp` + `commitAttachment` (new helpers in `server/src/uploads.js`) — share between profile photo, message attachments, check-in photos.
- Coil `ImageLoader` with bearer-token OkHttp interceptor (added in Phase 1.1, in `ProfileRepo.kt`) — re-use for attachment images on Android.
- `EventBus.events` Flow on Android, WS message switch on PWA — extend, don't replace.
- Pino logging: `req.log.warn({…}, 'event_name')`.

---

## Verification (end-to-end)

```bash
# Clean test server
cd "h:/family-guardian/server"
rm -rf data/test.db* data/uploads tmp-test 2>/dev/null
DATABASE_PATH="$(pwd)/data/test.db" PORT=8765 npm start
until curl -sf http://127.0.0.1:8765/healthz >/dev/null 2>&1; do sleep 1; done; echo READY

# Bootstrap signup (see HANDOFF.md snippet) → $TOKEN

# B1 — attachment
curl -F file=@small.jpg -F kind=image -F body="hi" \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8765/api/circles/1/messages/attachment
# Expect 200 with attachmentUrl. WS subscriber from another user sees chat_message with attachmentUrl.
curl -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8765/api/messages/<id>/attachment" -o out.jpg
# Compare with `exiftool small.jpg` and `exiftool out.jpg` — GPS gone.

# B2 — check-in photo
curl -F status=safe_home -F photo=@checkin.jpg \
  -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8765/api/checkins/with-photo
# Expect 200 with photoUrl. WS check_in event includes photoUrl.

# B3 — typing
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8765/api/circles/1/typing
# Expect 204. WS subscriber sees chat_typing event.
# Run 61 in 60s → 429.

# B4 — read receipts
curl -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"readReceiptsEnabled": true}' \
  http://127.0.0.1:8765/api/users/me
# Alice (opted in) reads Bob's (opted in) msg via /read-batch.
# Bob GET .../messages?withReaders=1 → readers array on msg 42.
# Eve GET same → no readers field on Bob's messages.

# Run vitest after each phase
npm test  # expect existing 59 + new tests passing
```

**UI smoke (per surface):**
- B1: Record audio, play audio. Image attachment shows inline. PWA on Safari falls back to webm and still records.
- B2: Check-in with photo shows thumb in dashboard pill on other surfaces.
- B3: Typing indicator appears in <1s and vanishes within 5s of stopping.
- B4: Settings toggle persists across logout. With both opted in, "Seen by …" surfaces on author's messages. Disabling on author side stops *new* receipts but preserves prior ones.

**Cleanup after testing:**
```bash
PID=$(netstat -ano | grep :8765 | grep LISTENING | head -1 | awk '{print $5}')
if [ -n "$PID" ]; then taskkill //F //PID $PID; fi
rm -rf h:/family-guardian/server/data/test.db* h:/family-guardian/server/data/uploads h:/family-guardian/server/tmp-test
```

---

## Risks and pause points

- **`db.transaction` foot-gun** — attachment routes can't wrap the file-write in a transaction (better-sqlite3 is sync). Use the row-first-then-file pattern with explicit rollback on failure. Tests must cover the "file write fails after row insert" path.
- **EXIF strip correctness** — pure-JS JPEG strip is small but error-prone. Add a test that synthesizes a JPEG with an APP1 segment containing GPS, runs the strip, asserts the output is shorter and parseable as JPEG.
- **Android `MediaPlayer` lifecycle** — must be released on composable dispose to avoid leaks. Use `DisposableEffect`.
- **iOS audio session** — `Audio.setAudioModeAsync({allowsRecordingIOS: true, playsInSilentModeIOS: true})` must be called before recording. Common pitfall.
- **Read-receipt retroactivity** — current plan ties the gate to *current* flag values at POST time. Turning the flag off retroactively does **not** delete prior rows. Document this in the Settings copy.
- **Pause after each sub-feature (B1 / B2 / B3 / B4) for human verification** before moving on, per house rules.
