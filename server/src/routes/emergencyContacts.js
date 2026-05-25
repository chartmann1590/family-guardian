import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { fanOutToUsers } from '../fcm.js';

const InviteBody = z.object({
    email: z.string().email(),
    autoRevokeOnCircleExit: z.boolean().optional(),
});

const RespondBody = z.object({
    action: z.enum(['accept', 'revoke']),
});

function rowToJson(r) {
    return {
        id: r.id,
        user_id: r.user_id,
        contactUserId: r.contact_user_id,
        contactDisplayName: r.contact_display_name || '',
        contactPhotoUrl: r.contact_photo_path ? `/api/users/${r.contact_user_id}/photo` : null,
        status: r.status,
        invitedAt: r.invited_at,
        acceptedAt: r.accepted_at,
        autoRevokeOnCircleExit: !!r.auto_revoke_on_circle_exit,
    };
}

export default async function emergencyContactRoutes(fastify, { db }) {
    fastify.get('/api/users/me/emergency-contacts', { preHandler: requireAuth(db) }, async (req) => {
        const now = Date.now();
        const rows = db.prepare(`
            SELECT ec.*, u.display_name AS contact_display_name, u.photo_path AS contact_photo_path
            FROM emergency_contacts ec
            JOIN users u ON u.id = ec.contact_user_id
            WHERE ec.user_id = ?
              AND (ec.status != 'pending' OR ec.pending_expires_at IS NULL OR ec.pending_expires_at > ?)
            ORDER BY ec.invited_at DESC
        `).all(req.auth.userId, now);
        return { contacts: rows.map(rowToJson) };
    });

    fastify.post('/api/users/me/emergency-contacts', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const parsed = InviteBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

        const contactUser = db.prepare('SELECT id, display_name FROM users WHERE email = ?').get(parsed.data.email);
        if (!contactUser) return reply.code(404).send({ error: 'contact_not_found', message: 'They need to install Family Guardian first.' });
        if (contactUser.id === req.auth.userId) return reply.code(400).send({ error: 'cannot_invite_self' });

        const existing = db.prepare('SELECT * FROM emergency_contacts WHERE user_id = ? AND contact_user_id = ?').get(req.auth.userId, contactUser.id);
        if (existing && existing.status === 'accepted') return reply.code(409).send({ error: 'already_accepted' });

        const count = db.prepare('SELECT COUNT(*) AS c FROM emergency_contacts WHERE user_id = ? AND status != ?').get(req.auth.userId, 'revoked')?.c ?? 0;
        if (count >= 5) return reply.code(429).send({ error: 'limit_reached', message: 'Maximum 5 emergency contacts.' });

        const now = Date.now();
        const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
        const autoRevoke = parsed.data.autoRevokeOnCircleExit ? 1 : 0;
        if (existing && existing.status === 'revoked') {
            db.prepare('UPDATE emergency_contacts SET status = ?, invited_at = ?, accepted_at = NULL, pending_expires_at = ?, auto_revoke_on_circle_exit = ? WHERE id = ?').run('pending', now, expiresAt, autoRevoke, existing.id);
        } else if (!existing) {
            db.prepare('INSERT INTO emergency_contacts (user_id, contact_user_id, status, invited_at, pending_expires_at, auto_revoke_on_circle_exit) VALUES (?, ?, ?, ?, ?, ?)').run(req.auth.userId, contactUser.id, 'pending', now, expiresAt, autoRevoke);
        }

        const callerName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.auth.userId)?.display_name || '';
        fanOutToUsers([contactUser.id], {
            type: 'emergency_contact_invite',
            fromUserId: req.auth.userId,
            fromDisplayName: callerName,
        }, db);

        const row = db.prepare(`
            SELECT ec.*, u.display_name AS contact_display_name, u.photo_path AS contact_photo_path
            FROM emergency_contacts ec JOIN users u ON u.id = ec.contact_user_id
            WHERE ec.user_id = ? AND ec.contact_user_id = ?
        `).get(req.auth.userId, contactUser.id);
        return rowToJson(row);
    });

    fastify.post('/api/users/me/emergency-contacts/:id/respond', { preHandler: requireAuth(db) }, async (req, reply) => {
        const contactId = Number(req.params.id);
        if (!Number.isInteger(contactId)) return reply.code(400).send({ error: 'invalid_id' });

        const parsed = RespondBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

        const row = db.prepare('SELECT * FROM emergency_contacts WHERE id = ?').get(contactId);
        if (!row) return reply.code(404).send({ error: 'not_found' });
        if (row.contact_user_id !== req.auth.userId) return reply.code(403).send({ error: 'forbidden' });
        if (row.status === 'pending' && row.pending_expires_at && row.pending_expires_at < Date.now()) {
            return reply.code(410).send({ error: 'invite_expired' });
        }

        const now = Date.now();
        if (parsed.data.action === 'accept') {
            db.prepare('UPDATE emergency_contacts SET status = ?, accepted_at = ? WHERE id = ?').run('accepted', now, contactId);
        } else {
            db.prepare('UPDATE emergency_contacts SET status = ? WHERE id = ?').run('revoked', contactId);
        }

        const updated = db.prepare(`
            SELECT ec.*, u.display_name AS contact_display_name, u.photo_path AS contact_photo_path
            FROM emergency_contacts ec JOIN users u ON u.id = ec.contact_user_id
            WHERE ec.id = ?
        `).get(contactId);
        return rowToJson(updated);
    });

    fastify.delete('/api/users/me/emergency-contacts/:id', { preHandler: requireAuth(db) }, async (req, reply) => {
        const contactId = Number(req.params.id);
        if (!Number.isInteger(contactId)) return reply.code(400).send({ error: 'invalid_id' });

        const row = db.prepare('SELECT * FROM emergency_contacts WHERE id = ?').get(contactId);
        if (!row) return reply.code(404).send({ error: 'not_found' });
        if (row.user_id !== req.auth.userId && row.contact_user_id !== req.auth.userId) {
            return reply.code(403).send({ error: 'forbidden' });
        }

        db.prepare('UPDATE emergency_contacts SET status = ? WHERE id = ?').run('revoked', contactId);
        return { ok: true };
    });

    fastify.get('/api/users/me/pending-invites', { preHandler: requireAuth(db) }, async (req) => {
        const now = Date.now();
        const rows = db.prepare(`
            SELECT ec.*, u.display_name AS contact_display_name, u.photo_path AS contact_photo_path
            FROM emergency_contacts ec
            JOIN users u ON u.id = ec.user_id
            WHERE ec.contact_user_id = ? AND ec.status = 'pending'
              AND (ec.pending_expires_at IS NULL OR ec.pending_expires_at > ?)
            ORDER BY ec.invited_at DESC
        `).all(req.auth.userId, now);
        return { invites: rows.map(r => ({
            id: r.id,
            fromUserId: r.user_id,
            fromDisplayName: r.contact_display_name || '',
            invitedAt: r.invited_at,
        })) };
    });
}
