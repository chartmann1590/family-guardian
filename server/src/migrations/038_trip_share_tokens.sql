CREATE TABLE IF NOT EXISTS trip_share_tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
    expires_at INTEGER NOT NULL,
    destination_lat REAL,
    destination_lng REAL,
    destination_label TEXT,
    max_views INTEGER,
    view_count INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_trip_shares_user ON trip_share_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_trip_shares_expires ON trip_share_tokens (expires_at);
