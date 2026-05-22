CREATE TABLE IF NOT EXISTS crash_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    circle_id       INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    detected_at     INTEGER NOT NULL,
    peak_accel_mps2 REAL    NOT NULL,
    sustained_ms    INTEGER NOT NULL,
    peak_axis_x     REAL,
    peak_axis_y     REAL,
    peak_axis_z     REAL,
    speed_mps       REAL,
    lat             REAL,
    lng             REAL,
    accuracy_m      REAL,
    activity        TEXT,
    platform        TEXT NOT NULL,
    dismissed_at    INTEGER,
    sos_event_id    INTEGER REFERENCES sos_events(id) ON DELETE SET NULL,
    note            TEXT
);
CREATE INDEX IF NOT EXISTS idx_crash_events_user_time
    ON crash_events(user_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_crash_events_circle_time
    ON crash_events(circle_id, detected_at DESC);
