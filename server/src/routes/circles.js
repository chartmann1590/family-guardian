import { randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { requireAuth } from '../auth.js';

function publicBaseUrl(req) {
    // Prefer the host the user actually used (LAN IP, hostname, etc.) so the
    // QR code / link works for them. Fall back to the request's host header.
    const fwdProto = req.headers['x-forwarded-proto'];
    const fwdHost = req.headers['x-forwarded-host'];
    const proto = (typeof fwdProto === 'string' ? fwdProto.split(',')[0].trim() : null) || req.protocol || 'http';
    const host = (typeof fwdHost === 'string' ? fwdHost.split(',')[0].trim() : null) || req.headers.host;
    return `${proto}://${host}`;
}

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

function generateInviteCode() {
    // 6-char alphanumeric — enough entropy for short-lived invites
    return randomBytes(6).toString('base64url').slice(0, 8).toUpperCase();
}

function assertAdmin(db, circleId, userId, reply) {
    const m = db
        .prepare('SELECT role FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!m) { reply.code(403).send({ error: 'not_a_member' }); return null; }
    if (m.role !== 'admin') { reply.code(403).send({ error: 'admin_only' }); return null; }
    return m;
}

export default async function circleRoutes(fastify, { db }) {
    fastify.post('/api/circles/:id/invite', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertAdmin(db, circleId, req.auth.userId, reply)) return;

        const now = Date.now();
        let code;
        for (let attempt = 0; attempt < 5; attempt++) {
            const candidate = generateInviteCode();
            const exists = db.prepare('SELECT 1 FROM invites WHERE code = ?').get(candidate);
            if (!exists) { code = candidate; break; }
        }
        if (!code) return reply.code(500).send({ error: 'invite_generation_failed' });

        db.prepare(
            'INSERT INTO invites (code, circle_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
        ).run(code, circleId, now, now + INVITE_TTL_MS);

        const joinUrl = `${publicBaseUrl(req)}/join?code=${code}`;
        const qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 220 });
        return { code, expiresAt: now + INVITE_TTL_MS, joinUrl, qrSvg };
    });

    fastify.get('/api/circles/:id/invites', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertAdmin(db, circleId, req.auth.userId, reply)) return;
        const now = Date.now();
        const rows = db
            .prepare(
                `SELECT code, created_at AS createdAt, expires_at AS expiresAt, used_by AS usedBy
                 FROM invites
                 WHERE circle_id = ? AND used_by IS NULL AND expires_at > ?
                 ORDER BY expires_at DESC`
            )
            .all(circleId, now);
        return { invites: rows };
    });

    fastify.delete('/api/invites/:code', { preHandler: requireAuth(db) }, async (req, reply) => {
        const code = String(req.params.code || '');
        const invite = db.prepare('SELECT * FROM invites WHERE code = ?').get(code);
        if (!invite) return reply.code(404).send({ error: 'not_found' });
        if (!assertAdmin(db, invite.circle_id, req.auth.userId, reply)) return;
        db.prepare('DELETE FROM invites WHERE code = ?').run(code);
        return { ok: true };
    });
}
