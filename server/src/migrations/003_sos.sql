-- SOS broadcasts. An "active" SOS is a row with status='active' and resolved_at IS NULL.
CREATE TABLE IF NOT EXISTS sos_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id     INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    started_at    INTEGER NOT NULL,
    resolved_at   INTEGER,
    resolved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    lat           REAL,
    lng           REAL,
    accuracy_m    REAL,
    note          TEXT,
    status        TEXT NOT NULL CHECK(status IN ('active','resolved')) DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_sos_circle_status ON sos_events(circle_id, status);
CREATE INDEX IF NOT EXISTS idx_sos_user_status   ON sos_events(user_id, status);
