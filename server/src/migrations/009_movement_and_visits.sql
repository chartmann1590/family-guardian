-- Movement metadata (bearing, altitude, activity) and dwell-detection tables.

ALTER TABLE locations           ADD COLUMN bearing REAL;
ALTER TABLE locations           ADD COLUMN altitude_m REAL;
ALTER TABLE locations           ADD COLUMN activity TEXT;
ALTER TABLE locations           ADD COLUMN activity_confidence INTEGER;

ALTER TABLE locations_history   ADD COLUMN bearing REAL;
ALTER TABLE locations_history   ADD COLUMN altitude_m REAL;
ALTER TABLE locations_history   ADD COLUMN activity TEXT;
ALTER TABLE locations_history   ADD COLUMN activity_confidence INTEGER;

CREATE TABLE IF NOT EXISTS visits (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    circle_id   INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    place_id    INTEGER REFERENCES places(id) ON DELETE SET NULL,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    label       TEXT,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    point_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_visits_user_started   ON visits(user_id,   started_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_circle_started ON visits(circle_id, started_at DESC);

CREATE TABLE IF NOT EXISTS trips (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    circle_id     INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    mode          TEXT NOT NULL,
    distance_m    REAL NOT NULL DEFAULT 0,
    max_speed_mps REAL,
    avg_speed_mps REAL,
    start_lat     REAL,
    start_lng     REAL,
    end_lat       REAL,
    end_lng       REAL,
    start_label   TEXT,
    end_label     TEXT
);
CREATE INDEX IF NOT EXISTS idx_trips_user_started ON trips(user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS geocode_cache (
    lat_round  REAL NOT NULL,
    lng_round  REAL NOT NULL,
    label      TEXT,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (lat_round, lng_round)
);
