CREATE TABLE IF NOT EXISTS routines (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    circle_id         INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    place_id          INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    kind              TEXT    NOT NULL CHECK(kind IN ('arrival','departure')),
    day_of_week       INTEGER NOT NULL CHECK(day_of_week BETWEEN 0 AND 6),
    expected_minute   INTEGER NOT NULL CHECK(expected_minute BETWEEN 0 AND 1439),
    tolerance_minutes INTEGER NOT NULL CHECK(tolerance_minutes BETWEEN 5 AND 180),
    sample_count      INTEGER NOT NULL DEFAULT 0,
    confidence        REAL    NOT NULL DEFAULT 0,
    source            TEXT    NOT NULL DEFAULT 'auto' CHECK(source IN ('auto','manual')),
    active            INTEGER NOT NULL DEFAULT 1,
    first_seen_at     INTEGER,
    last_seen_at      INTEGER,
    last_observed_at  INTEGER,
    created_at        INTEGER NOT NULL,
    updated_at        INTEGER NOT NULL,
    UNIQUE (user_id, place_id, kind, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_routines_circle   ON routines(circle_id, active) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_routines_subject  ON routines(user_id, active)   WHERE active = 1;
