CREATE TABLE IF NOT EXISTS message_reads (
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    read_at     INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_message_reads_message ON message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reads_user    ON message_reads(user_id, read_at DESC);

ALTER TABLE users ADD COLUMN read_receipts_enabled INTEGER NOT NULL DEFAULT 0;
