import { z } from 'zod';
import {
    hashPassword,
    verifyPassword,
    createSession,
    destroySession,
    extractToken,
    lookupSession,
} from '../auth.js';

const SignupBody = z.object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(256),
    displayName: z.string().min(1).max(64),
    inviteCode: z.string().min(4).max(64).optional(),
    circleName: z.string().min(1).max(64).optional(),
});

const LoginBody = z.object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(256),
});

const COOKIE_OPTS = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
};

export default async function authRoutes(fastify, { db }) {
    fastify.post('/api/auth/signup', {
        config: { rateLimit: { max: Number(process.env.SIGNUP_RATE_LIMIT) || 5, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const parsed = SignupBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });
        }
        const { email, password, displayName, inviteCode, circleName } = parsed.data;

        const adminCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
        const isBootstrap = adminCount === 0;

        if (!isBootstrap && !inviteCode) {
            return reply.code(400).send({ error: 'invite_code_required' });
        }

        let invite = null;
        if (!isBootstrap) {
            invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(inviteCode);
            if (!invite) return reply.code(400).send({ error: 'invalid_invite' });
            if (invite.expires_at < Date.now()) return reply.code(400).send({ error: 'invite_expired' });
            if (invite.used_by) return reply.code(400).send({ error: 'invite_used' });
        }

        const exists = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
        if (exists) return reply.code(409).send({ error: 'email_taken' });

        const hash = await hashPassword(password);
        const now = Date.now();

        const tx = db.transaction(() => {
            const userResult = db
                .prepare(
                    'INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)'
                )
                .run(email, hash, displayName, now);
            const userId = Number(userResult.lastInsertRowid);

            let circleId;
            let role;
            if (isBootstrap) {
                const circleResult = db
                    .prepare('INSERT INTO circles (name, owner_id, created_at) VALUES (?, ?, ?)')
                    .run(circleName || `${displayName}'s Family`, userId, now);
                circleId = Number(circleResult.lastInsertRowid);
                role = 'admin';
            } else {
                circleId = invite.circle_id;
                role = 'member';
                db.prepare('UPDATE invites SET used_by = ? WHERE code = ?').run(userId, invite.code);
            }

            db.prepare(
                'INSERT INTO circle_members (circle_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
            ).run(circleId, userId, role, now);

            return { userId, circleId, role };
        });

        const { userId, circleId, role } = tx();
        const { token } = createSession(db, userId);
        const readReceiptsEnabled = !!db.prepare('SELECT read_receipts_enabled FROM users WHERE id = ?').get(userId)?.read_receipts_enabled;
        const crashDetectionEnabled = !!db.prepare('SELECT crash_detection_enabled FROM users WHERE id = ?').get(userId)?.crash_detection_enabled;

        const circles = db.prepare(
            'SELECT cm.circle_id AS circleId, cm.role FROM circle_members cm WHERE cm.user_id = ?'
        ).all(userId);

        reply.setCookie('fg_session', token, COOKIE_OPTS);
        return { token, userId, circleId, role, displayName, readReceiptsEnabled, crashDetectionEnabled, circles };
    });

    fastify.post('/api/auth/login', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const parsed = LoginBody.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'invalid_body' });
        }
        const { email, password } = parsed.data;
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user || !(await verifyPassword(user.password_hash, password))) {
            req.log.warn({ ip: req.ip, email }, 'login_failed');
            return reply.code(401).send({ error: 'invalid_credentials' });
        }

        const totpRow = db.prepare('SELECT enabled FROM user_totp WHERE user_id = ?').get(user.id);
        if (totpRow && totpRow.enabled) {
            const { token: challengeToken } = createSession(db, user.id);
            reply.setCookie('fg_session', challengeToken, COOKIE_OPTS);
            return { requiresTotp: true, challengeToken };
        }

        const { token } = createSession(db, user.id);
        reply.setCookie('fg_session', token, COOKIE_OPTS);
        const circleId = db
            .prepare('SELECT circle_id AS circleId FROM circle_members WHERE user_id = ? ORDER BY joined_at ASC LIMIT 1')
            .get(user.id)?.circleId;
        const readReceiptsEnabled = !!user.read_receipts_enabled;
        const crashDetectionEnabled = !!user.crash_detection_enabled;

        const circles = db.prepare(
            'SELECT cm.circle_id AS circleId, cm.role FROM circle_members cm WHERE cm.user_id = ?'
        ).all(user.id);

        return { token, userId: user.id, circleId, displayName: user.display_name, readReceiptsEnabled, crashDetectionEnabled, circles };
    });

    fastify.post('/api/auth/logout', async (req, reply) => {
        const token = extractToken(req);
        if (token) destroySession(db, token);
        reply.clearCookie('fg_session', { path: '/' });
        return { ok: true };
    });

    fastify.get('/api/auth/me', async (req, reply) => {
        const session = lookupSession(db, extractToken(req));
        if (!session) return reply.code(401).send({ error: 'unauthorized' });
        const circleId = db
            .prepare('SELECT circle_id AS circleId FROM circle_members WHERE user_id = ? ORDER BY joined_at ASC LIMIT 1')
            .get(session.userId)?.circleId;
        const circles = db.prepare(
            'SELECT cm.circle_id AS circleId, cm.role FROM circle_members cm WHERE cm.user_id = ?'
        ).all(session.userId);
        return {
            userId: session.userId,
            email: session.email,
            displayName: session.displayName,
            circleId,
            circles,
        };
    });

    fastify.get('/api/users/me/circles', { preHandler: async (req, reply) => {
        const token = extractToken(req);
        const session = lookupSession(db, token);
        if (!session) { reply.code(401).send({ error: 'unauthorized' }); return; }
        req.auth = { token, ...session };
    } }, async (req) => {
        const circles = db.prepare(`
            SELECT cm.circle_id AS circleId, c.name, cm.role, cm.joined_at AS joinedAt
            FROM circle_members cm
            JOIN circles c ON c.id = cm.circle_id
            WHERE cm.user_id = ?
            ORDER BY cm.joined_at ASC
        `).all(req.auth.userId);
        return { circles };
    });

    fastify.post('/api/users/me/active-circle', { preHandler: async (req, reply) => {
        const token = extractToken(req);
        const session = lookupSession(db, token);
        if (!session) { reply.code(401).send({ error: 'unauthorized' }); return; }
        req.auth = { token, ...session };
    } }, async (req, reply) => {
        const body = z.object({ circleId: z.number().int().positive() }).safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

        const membership = db.prepare(
            'SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?'
        ).get(body.data.circleId, req.auth.userId);
        if (!membership) return reply.code(403).send({ error: 'not_a_member' });

        db.prepare('UPDATE users SET last_circle_id = ? WHERE id = ?')
            .run(body.data.circleId, req.auth.userId);

        return { ok: true };
    });
}
