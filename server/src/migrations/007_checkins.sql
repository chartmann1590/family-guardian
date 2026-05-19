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
