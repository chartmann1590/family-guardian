CREATE TABLE IF NOT EXISTS routine_alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id      INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    circle_id       INTEGER NOT NULL REFERENCES circles(id)  ON DELETE CASCADE,
    kind            TEXT    NOT NULL CHECK(kind IN ('missed_arrival','overstay','early_departure')),
    fired_at        INTEGER NOT NULL,
    fired_local_date TEXT    NOT NULL,
    expected_minute INTEGER NOT NULL,
    actual_minute   INTEGER,
    created_at      INTEGER NOT NULL,
    UNIQUE (routine_id, fired_local_date)
);
CREATE INDEX IF NOT EXISTS idx_routine_alerts_circle ON routine_alerts(circle_id, fired_at DESC);
