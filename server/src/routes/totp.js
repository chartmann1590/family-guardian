import { z } from 'zod';
import argon2 from 'argon2';
import { requireAuth, createSession } from '../auth.js';
import { randomBytes } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';

export default async function totpRoutes(fastify, { db }) {

    fastify.post('/api/users/me/totp/enroll-start', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const userId = req.auth.userId;
        const existing = db.prepare('SELECT enabled FROM user_totp WHERE user_id = ?').get(userId);
        if (existing && existing.enabled) return reply.code(409).send({ error: 'already_enabled' });

        const secret = new Secret({ size: 20 });
        const totp = new TOTP({
            issuer: 'Family Guardian',
            label: req.auth.email,
            secret,
            digits: 6,
            period: 30,
        });

        const secretBase32 = secret.base32;
        const provisioningUri = totp.toString();

        db.prepare(`
            INSERT INTO user_totp (user_id, secret, enabled, enrolled_at)
            VALUES (?, ?, 0, ?)
            ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0, enrolled_at = excluded.enrolled_at
        `).run(userId, secretBase32, Date.now());

        return { provisioningUri, secret: secretBase32 };
    });

    fastify.post('/api/users/me/totp/enroll-confirm', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const body = z.object({ code: z.string().length(6) }).safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

        const userId = req.auth.userId;
        const row = db.prepare('SELECT * FROM user_totp WHERE user_id = ?').get(userId);
        if (!row) return reply.code(400).send({ error: 'not_started' });
        if (row.enabled) return reply.code(409).send({ error: 'already_enabled' });

        const totp = new TOTP({
            issuer: 'Family Guardian',
            secret: Secret.fromBase32(row.secret),
            digits: 6,
            period: 30,
        });

        const delta = totp.validate({ token: body.data.code, window: 1 });
        if (delta === null) return reply.code(401).send({ error: 'invalid_code' });

        const backupCodes = [];
        const backupHashes = [];
        for (let i = 0; i < 10; i++) {
            const code = randomBytes(4).toString('hex');
            backupCodes.push(code);
            backupHashes.push(await argon2.hash(code, { type: argon2.argon2id }));
        }

        db.prepare('UPDATE user_totp SET enabled = 1, backup_codes_hash = ? WHERE user_id = ?')
            .run(JSON.stringify(backupHashes), userId);

        return { backupCodes };
    });

    fastify.post('/api/users/me/totp/disable', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const body = z.object({
            password: z.string().min(1),
            code: z.string().length(6).optional(),
        }).safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

        const userId = req.auth.userId;
        const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
        if (!user) return reply.code(404).send({ error: 'not_found' });

        const { verifyPassword } = await import('../auth.js');
        if (!(await verifyPassword(user.password_hash, body.data.password))) {
            return reply.code(401).send({ error: 'wrong_password' });
        }

        db.prepare('DELETE FROM user_totp WHERE user_id = ?').run(userId);
        return { ok: true };
    });

    fastify.post('/api/auth/login/totp', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const body = z.object({
            challengeToken: z.string().min(1),
            code: z.string().min(1),
        }).safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_body' });

        const { challengeToken, code } = body.data;
        const challenge = db.prepare('SELECT * FROM sessions WHERE token = ?').get(challengeToken);
        if (!challenge || challenge.expires_at < Date.now()) {
            return reply.code(401).send({ error: 'invalid_challenge' });
        }

        const userId = challenge.user_id;
        const totpRow = db.prepare('SELECT * FROM user_totp WHERE user_id = ? AND enabled = 1').get(userId);
        if (!totpRow) return reply.code(400).send({ error: 'totp_not_enabled' });

        const totp = new TOTP({
            secret: Secret.fromBase32(totpRow.secret),
            digits: 6,
            period: 30,
        });

        let valid = totp.validate({ token: code, window: 1 }) !== null;

        if (!valid && totpRow.backup_codes_hash) {
            const hashes = JSON.parse(totpRow.backup_codes_hash);
            for (let i = 0; i < hashes.length; i++) {
                const { verifyPassword } = await import('../auth.js');
                if (await verifyPassword(hashes[i], code)) {
                    valid = true;
                    hashes.splice(i, 1);
                    db.prepare('UPDATE user_totp SET backup_codes_hash = ? WHERE user_id = ?')
                        .run(JSON.stringify(hashes), userId);
                    break;
                }
            }
        }

        if (!valid) return reply.code(401).send({ error: 'invalid_code' });

        db.prepare('DELETE FROM sessions WHERE token = ?').run(challengeToken);
        const { token } = createSession(db, userId);

        const COOKIE_OPTS = {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
        };
        reply.setCookie('fg_session', token, COOKIE_OPTS);

        const user = db.prepare('SELECT id, display_name, read_receipts_enabled, crash_detection_enabled FROM users WHERE id = ?').get(userId);
        const circleId = db.prepare('SELECT circle_id AS circleId FROM circle_members WHERE user_id = ? LIMIT 1').get(userId)?.circleId;

        return {
            token,
            userId,
            circleId,
            displayName: user?.display_name,
            readReceiptsEnabled: !!user?.read_receipts_enabled,
            crashDetectionEnabled: !!user?.crash_detection_enabled,
        };
    });
}
