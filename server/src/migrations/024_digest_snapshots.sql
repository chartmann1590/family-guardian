CREATE TABLE IF NOT EXISTS digest_snapshots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    circle_id     INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    week_start    INTEGER NOT NULL,
    week_end      INTEGER NOT NULL,
    summary_json  TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    UNIQUE (circle_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_digest_circle ON digest_snapshots(circle_id, week_start DESC);

ALTER TABLE alert_prefs ADD COLUMN weekly_digest_enabled INTEGER NOT NULL DEFAULT 0;
