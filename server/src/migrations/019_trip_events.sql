CREATE TABLE IF NOT EXISTS trip_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id       INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL CHECK(kind IN ('hard_brake','speeding_start','speeding_end','night_segment')),
    occurred_at   INTEGER NOT NULL,
    value         REAL,
    lat           REAL,
    lng           REAL,
    meta          TEXT
);
CREATE INDEX IF NOT EXISTS idx_trip_events_trip ON trip_events(trip_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_trip_events_user_time
    ON trip_events(user_id, occurred_at DESC);

ALTER TABLE users ADD COLUMN crash_detection_enabled INTEGER NOT NULL DEFAULT 0;
