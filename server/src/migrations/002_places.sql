-- Safety places (geofences) and per-user presence tracking.
CREATE TABLE IF NOT EXISTS places (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id       INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    address         TEXT,
    lat             REAL NOT NULL,
    lng             REAL NOT NULL,
    radius_m        REAL NOT NULL CHECK(radius_m > 0),
    alerts_on_enter INTEGER NOT NULL DEFAULT 1,
    alerts_on_exit  INTEGER NOT NULL DEFAULT 1,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_places_circle ON places(circle_id);

-- One row per (user, place) while the user is *inside* the radius.
-- A delete + insert is the cleanest way to represent transitions.
CREATE TABLE IF NOT EXISTS place_presence (
    user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    place_id   INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    entered_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, place_id)
);
