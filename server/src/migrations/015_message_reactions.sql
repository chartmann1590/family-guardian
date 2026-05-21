CREATE TABLE IF NOT EXISTS message_reactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    emoji       TEXT    NOT NULL CHECK(length(emoji) BETWEEN 1 AND 8),
    created_at  INTEGER NOT NULL,
    UNIQUE(message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
