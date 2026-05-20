-- Audit log recording who viewed whose history/visits/trips/member page.
-- Self-views are skipped at the application layer; the 5-minute debounce
-- prevents duplicate rows when the same viewer hits the same resource
-- repeatedly within a short window.

CREATE TABLE IF NOT EXISTS view_audits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    viewer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resource   TEXT NOT NULL CHECK(resource IN ('history','visits','trips','member_page')),
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_view_audits_subject
    ON view_audits(subject_id, created_at DESC);
