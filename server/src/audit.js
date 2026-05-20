const DEBOUNCE_MS = 5 * 60_000;
const VALID_RESOURCES = new Set(['history', 'visits', 'trips', 'member_page']);

const insertStmt = (db) =>
    db.prepare(
        `INSERT INTO view_audits (viewer_id, subject_id, resource, created_at)
         VALUES (?, ?, ?, ?)`,
    );

const recentStmt = (db) =>
    db.prepare(
        `SELECT 1 FROM view_audits
         WHERE viewer_id = ? AND subject_id = ? AND resource = ? AND created_at > ?
         LIMIT 1`,
    );

export function logView(db, viewerId, subjectId, resource) {
    if (viewerId === subjectId) return;
    if (!VALID_RESOURCES.has(resource)) return;
    const now = Date.now();
    const recent = recentStmt(db).get(viewerId, subjectId, resource, now - DEBOUNCE_MS);
    if (recent) return;
    insertStmt(db).run(viewerId, subjectId, resource, now);
}
