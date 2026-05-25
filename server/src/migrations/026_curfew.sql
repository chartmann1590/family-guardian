ALTER TABLE alert_prefs ADD COLUMN curfew_enabled        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE alert_prefs ADD COLUMN curfew_start          INTEGER;
ALTER TABLE alert_prefs ADD COLUMN curfew_end            INTEGER;
ALTER TABLE alert_prefs ADD COLUMN curfew_home_place_id  INTEGER REFERENCES places(id) ON DELETE SET NULL;

ALTER TABLE routine_alerts RENAME TO routine_alerts_old2;

CREATE TABLE routine_alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id      INTEGER          REFERENCES routines(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    circle_id       INTEGER NOT NULL REFERENCES circles(id)  ON DELETE CASCADE,
    kind            TEXT    NOT NULL CHECK(kind IN ('missed_arrival','overstay','early_departure','overstay_dwell','curfew_violation')),
    fired_at        INTEGER NOT NULL,
    fired_local_date TEXT   NOT NULL,
    expected_minute INTEGER NOT NULL,
    actual_minute   INTEGER,
    created_at      INTEGER NOT NULL,
    UNIQUE (user_id, kind, fired_local_date)
);

INSERT INTO routine_alerts (id, routine_id, user_id, circle_id, kind, fired_at, fired_local_date, expected_minute, actual_minute, created_at)
SELECT id, routine_id, user_id, circle_id, kind, fired_at, fired_local_date, expected_minute, actual_minute, created_at FROM routine_alerts_old2;

DROP TABLE routine_alerts_old2;

CREATE INDEX IF NOT EXISTS idx_routine_alerts_circle ON routine_alerts(circle_id, fired_at DESC);
