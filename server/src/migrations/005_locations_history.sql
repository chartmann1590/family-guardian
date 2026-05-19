-- Append-only location history. The `locations` table keeps only the current fix
-- (ON CONFLICT DO UPDATE) for fast dashboard queries; this table records every
-- fix so we can reconstruct a member's path over time.

CREATE TABLE IF NOT EXISTS locations_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lat          REAL NOT NULL,
    lng          REAL NOT NULL,
    accuracy_m   REAL,
    speed_mps    REAL,
    battery_pct  INTEGER,
    recorded_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_locations_history_user_time
    ON locations_history(user_id, recorded_at DESC);
