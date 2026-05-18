-- Family chat. Each circle has one persistent text channel.
CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id    INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    user_id      INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    body         TEXT NOT NULL,
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_circle_created ON messages(circle_id, created_at DESC);
