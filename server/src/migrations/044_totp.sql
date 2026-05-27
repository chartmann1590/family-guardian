CREATE TABLE IF NOT EXISTS user_totp (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    secret TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    backup_codes_hash TEXT,
    enrolled_at INTEGER
);
