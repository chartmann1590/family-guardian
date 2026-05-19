import argon2 from 'argon2';

/**
 * If the DB has zero users and BOOTSTRAP_ADMIN_EMAIL+PASSWORD+DISPLAY_NAME are
 * set, create the admin user and an initial circle automatically. This lets
 * self-hosters skip the /setup wizard entirely by configuring the env vars
 * in docker-compose. Idempotent: subsequent boots are a no-op if a user
 * already exists.
 */
export async function maybeBootstrapAdmin(db, log) {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const displayName = process.env.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim();
    if (!email || !password || !displayName) return;

    const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (userCount > 0) return;

    if (password.length < 8) {
        log.warn({}, 'bootstrap_skipped_password_too_short');
        return;
    }

    const circleName = process.env.BOOTSTRAP_CIRCLE_NAME?.trim() || `${displayName}'s Family`;
    const hash = await argon2.hash(password);
    const now = Date.now();
    const tx = db.transaction(() => {
        const u = db
            .prepare(
                'INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)',
            )
            .run(email, hash, displayName, now);
        const userId = Number(u.lastInsertRowid);
        const c = db
            .prepare('INSERT INTO circles (name, owner_id, created_at) VALUES (?, ?, ?)')
            .run(circleName, userId, now);
        const circleId = Number(c.lastInsertRowid);
        db.prepare(
            'INSERT INTO circle_members (circle_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
        ).run(circleId, userId, 'admin', now);
        return { userId, circleId };
    });
    const { userId, circleId } = tx();
    log.info({ userId, circleId, email }, 'bootstrap_admin_created');
}
