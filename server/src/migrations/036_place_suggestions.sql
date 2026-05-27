CREATE TABLE IF NOT EXISTS place_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    label TEXT,
    visit_count INTEGER NOT NULL DEFAULT 0,
    total_dwell_ms INTEGER NOT NULL DEFAULT 0,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','dismissed')),
    dismissed_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_place_suggestions_grid
    ON place_suggestions (user_id, round(lat, 3), round(lng, 3));
