CREATE TABLE IF NOT EXISTS last_battery_state (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    last_pct INTEGER NOT NULL,
    last_alert_at INTEGER NOT NULL
);
