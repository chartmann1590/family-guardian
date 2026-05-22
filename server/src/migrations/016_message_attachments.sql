ALTER TABLE messages ADD COLUMN attachment_kind TEXT
    CHECK(attachment_kind IS NULL OR attachment_kind IN ('audio','image'));
ALTER TABLE messages ADD COLUMN attachment_path TEXT;
ALTER TABLE messages ADD COLUMN attachment_mime TEXT;
ALTER TABLE messages ADD COLUMN attachment_bytes INTEGER;
ALTER TABLE messages ADD COLUMN attachment_duration_ms INTEGER;
