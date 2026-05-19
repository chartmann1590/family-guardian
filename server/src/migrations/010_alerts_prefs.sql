-- Per-user alert preferences and the alert event log.

CREATE TABLE IF NOT EXISTS alert_prefs (
    user_id                INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    speeding_enabled       INTEGER NOT NULL DEFAULT 1,
    speeding_threshold_mps REAL    NOT NULL DEFAULT 31.3,
    low_battery_enabled    INTEGER NOT NULL DEFAULT 1,
    low_battery_threshold  INTEGER NOT NULL DEFAULT 15,
    offline_enabled        INTEGER NOT NULL DEFAULT 1,
    offline_minutes        INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE IF NOT EXISTS alert_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    circle_id  INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    value      REAL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_events_circle ON alert_events(circle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_user   ON alert_events(user_id,   created_at DESC);
