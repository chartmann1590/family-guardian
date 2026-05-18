-- Family Guardian / GuardianMesh — initial schema
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS circles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS circle_members (
    circle_id   INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK(role IN ('admin','member')),
    joined_at   INTEGER NOT NULL,
    PRIMARY KEY (circle_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
    code        TEXT PRIMARY KEY,
    circle_id   INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    used_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS locations (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    lat             REAL NOT NULL,
    lng             REAL NOT NULL,
    accuracy_m      REAL,
    speed_mps       REAL,
    battery_pct     INTEGER,
    recorded_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_circle_members_user ON circle_members(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user        ON sessions(user_id);
