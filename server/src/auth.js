import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';

const SESSION_DAYS = 30;

export async function hashPassword(plain) {
    return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash, plain) {
    try {
        return await argon2.verify(hash, plain);
    } catch {
        return false;
    }
}

export function createSession(db, userId) {
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
    db.prepare(
        'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    ).run(token, userId, now, expiresAt);
    return { token, expiresAt };
}

export function destroySession(db, token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function lookupSession(db, token) {
    if (!token) return null;
    const row = db
        .prepare(
            `SELECT s.user_id AS userId, s.expires_at AS expiresAt,
                    u.email, u.display_name AS displayName
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?`
        )
        .get(token);
    if (!row) return null;
    if (row.expiresAt < Date.now()) {
        destroySession(db, token);
        return null;
    }
    return row;
}

export function extractToken(req) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
    const cookie = req.cookies?.fg_session;
    return cookie || null;
}

export function requireAuth(db) {
    return async function (req, reply) {
        const token = extractToken(req);
        const session = lookupSession(db, token);
        if (!session) {
            reply.code(401).send({ error: 'unauthorized' });
            return;
        }
        req.auth = { token, ...session };
    };
}

export function getUserCircleId(db, userId) {
    const row = db
        .prepare('SELECT circle_id AS circleId FROM circle_members WHERE user_id = ? LIMIT 1')
        .get(userId);
    return row?.circleId ?? null;
}
