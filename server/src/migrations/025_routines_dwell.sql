-- Migration runner wraps in BEGIN/COMMIT; defer_foreign_keys is transaction-scoped
-- and lets us rebuild the table while routine_alerts.routine_id keeps referencing it.
PRAGMA defer_foreign_keys = ON;

ALTER TABLE routines RENAME TO routines_old;

CREATE TABLE routines (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                 INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    circle_id               INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    place_id                INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    kind                    TEXT    NOT NULL CHECK(kind IN ('arrival','departure','dwell')),
    day_of_week             INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    expected_minute         INTEGER NOT NULL CHECK(expected_minute BETWEEN 0 AND 1439),
    expected_dwell_minutes  INTEGER          CHECK(expected_dwell_minutes IS NULL OR expected_dwell_minutes BETWEEN 5 AND 1439),
    tolerance_minutes       INTEGER NOT NULL CHECK(tolerance_minutes BETWEEN 5 AND 180),
    sample_count            INTEGER NOT NULL DEFAULT 0,
    confidence              REAL    NOT NULL DEFAULT 0,
    source                  TEXT    NOT NULL DEFAULT 'auto' CHECK(source IN ('auto','manual')),
    active                  INTEGER NOT NULL DEFAULT 1,
    first_seen_at           INTEGER,
    last_seen_at            INTEGER,
    last_observed_at        INTEGER,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL,
    UNIQUE (user_id, place_id, kind, day_of_week)
);

INSERT INTO routines (
    id, user_id, circle_id, place_id, kind, day_of_week, expected_minute,
    expected_dwell_minutes, tolerance_minutes, sample_count, confidence,
    source, active, first_seen_at, last_seen_at, last_observed_at, created_at, updated_at
)
SELECT id, user_id, circle_id, place_id, kind, day_of_week, expected_minute,
       NULL, tolerance_minutes, sample_count, confidence,
       source, active, first_seen_at, last_seen_at, last_observed_at, created_at, updated_at
FROM routines_old;

DROP TABLE routines_old;

CREATE INDEX IF NOT EXISTS idx_routines_circle  ON routines(circle_id, active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_routines_subject ON routines(user_id, active)   WHERE active = 1;

ALTER TABLE routine_alerts RENAME TO routine_alerts_old;

CREATE TABLE routine_alerts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    routine_id      INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    circle_id       INTEGER NOT NULL REFERENCES circles(id)  ON DELETE CASCADE,
    kind            TEXT    NOT NULL CHECK(kind IN ('missed_arrival','overstay','early_departure','overstay_dwell','curfew_violation')),
    fired_at        INTEGER NOT NULL,
    fired_local_date TEXT   NOT NULL,
    expected_minute INTEGER NOT NULL,
    actual_minute   INTEGER,
    created_at      INTEGER NOT NULL,
    UNIQUE (routine_id, fired_local_date)
);

INSERT INTO routine_alerts SELECT * FROM routine_alerts_old;

DROP TABLE routine_alerts_old;

CREATE INDEX IF NOT EXISTS idx_routine_alerts_circle ON routine_alerts(circle_id, fired_at DESC);
