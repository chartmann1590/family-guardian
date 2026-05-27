import { z } from 'zod';
import { requireAuth } from '../auth.js';

const SubBody = z.object({
    placeId: z.number().int().positive(),
    memberId: z.number().int().positive().nullable().optional(),
    onEnter: z.boolean().optional().default(true),
    onExit: z.boolean().optional().default(true),
    quietStart: z.number().int().min(0).max(1439).nullable().optional(),
    quietEnd: z.number().int().min(0).max(1439).nullable().optional(),
    daysOfWeek: z.number().int().min(0).max(127).optional().default(127),
    windowStart: z.number().int().min(0).max(1439).nullable().optional(),
    windowEnd: z.number().int().min(0).max(1439).nullable().optional(),
});

const SubPatch = z.object({
    onEnter: z.boolean().optional(),
    onExit: z.boolean().optional(),
    quietStart: z.number().int().min(0).max(1439).nullable().optional(),
    quietEnd: z.number().int().min(0).max(1439).nullable().optional(),
    daysOfWeek: z.number().int().min(0).max(127).optional(),
    windowStart: z.number().int().min(0).max(1439).nullable().optional(),
    windowEnd: z.number().int().min(0).max(1439).nullable().optional(),
});

function assertMember(db, circleId, userId, reply) {
    const row = db
        .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!row) {
        reply.code(403).send({ error: 'not_a_member' });
        return false;
    }
    return true;
}

function rowToSub(r) {
    return {
        id: r.id,
        userId: r.user_id,
        placeId: r.place_id,
        memberId: r.member_id,
        placeName: r.place_name,
        memberName: r.member_id ? r.member_name : 'Anyone',
        onEnter: !!r.on_enter,
        onExit: !!r.on_exit,
        quietStart: r.quiet_start,
        quietEnd: r.quiet_end,
        daysOfWeek: r.days_of_week ?? 127,
        windowStart: r.window_start,
        windowEnd: r.window_end,
        createdAt: r.created_at,
    };
}

export default async function placeSubRoutes(fastify, { db }) {

    fastify.get('/api/circles/:id/place-subscriptions', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const rows = db.prepare(
            `SELECT ps.*, p.name AS place_name, u.display_name AS member_name
             FROM place_subscriptions ps
             JOIN places p ON p.id = ps.place_id
             LEFT JOIN users u ON u.id = ps.member_id
             WHERE ps.user_id = ?
             ORDER BY p.name COLLATE NOCASE ASC, member_name COLLATE NOCASE ASC`
        ).all(req.auth.userId);

        return { subscriptions: rows.map(rowToSub) };
    });

    fastify.post('/api/circles/:id/place-subscriptions', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const circleId = Number(req.params.id);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const parsed = SubBody.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

        const { placeId, memberId, onEnter, onExit, quietStart, quietEnd, daysOfWeek, windowStart, windowEnd } = parsed.data;

        const place = db.prepare('SELECT id FROM places WHERE id = ? AND circle_id = ?').get(placeId, circleId);
        if (!place) return reply.code(400).send({ error: 'place_not_in_circle' });

        if (memberId != null) {
            const member = db
                .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
                .get(circleId, memberId);
            if (!member) return reply.code(400).send({ error: 'member_not_in_circle' });
        }

        const now = Date.now();
        db.prepare(
            `INSERT INTO place_subscriptions (user_id, place_id, member_id, on_enter, on_exit, quiet_start, quiet_end, days_of_week, window_start, window_end, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_id, place_id, member_id) DO UPDATE SET
               on_enter = excluded.on_enter,
               on_exit  = excluded.on_exit,
               quiet_start = excluded.quiet_start,
               quiet_end   = excluded.quiet_end,
               days_of_week = excluded.days_of_week,
               window_start = excluded.window_start,
               window_end   = excluded.window_end`
        ).run(req.auth.userId, placeId, memberId ?? null, onEnter ? 1 : 0, onExit ? 1 : 0, quietStart ?? null, quietEnd ?? null, daysOfWeek ?? 127, windowStart ?? null, windowEnd ?? null, now);

        const row = db.prepare(
            `SELECT ps.*, p.name AS place_name, u.display_name AS member_name
             FROM place_subscriptions ps
             JOIN places p ON p.id = ps.place_id
             LEFT JOIN users u ON u.id = ps.member_id
             WHERE ps.user_id = ? AND ps.place_id = ? AND ps.member_id IS ?`
        ).get(req.auth.userId, placeId, memberId ?? null);

        return rowToSub(row);
    });

    fastify.patch('/api/place-subscriptions/:id', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const subId = Number(req.params.id);
        if (!Number.isInteger(subId)) return reply.code(400).send({ error: 'invalid_subscription' });

        const existing = db.prepare('SELECT * FROM place_subscriptions WHERE id = ?').get(subId);
        if (!existing) return reply.code(404).send({ error: 'not_found' });
        if (existing.user_id !== req.auth.userId) return reply.code(403).send({ error: 'not_owner' });

        const parsed = SubPatch.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body' });

        const merged = {
            on_enter: parsed.data.onEnter !== undefined ? (parsed.data.onEnter ? 1 : 0) : existing.on_enter,
            on_exit: parsed.data.onExit !== undefined ? (parsed.data.onExit ? 1 : 0) : existing.on_exit,
            quiet_start: parsed.data.quietStart !== undefined ? parsed.data.quietStart : existing.quiet_start,
            quiet_end: parsed.data.quietEnd !== undefined ? parsed.data.quietEnd : existing.quiet_end,
            days_of_week: parsed.data.daysOfWeek !== undefined ? parsed.data.daysOfWeek : (existing.days_of_week ?? 127),
            window_start: parsed.data.windowStart !== undefined ? parsed.data.windowStart : existing.window_start,
            window_end: parsed.data.windowEnd !== undefined ? parsed.data.windowEnd : existing.window_end,
        };

        db.prepare(
            `UPDATE place_subscriptions SET on_enter = ?, on_exit = ?, quiet_start = ?, quiet_end = ?, days_of_week = ?, window_start = ?, window_end = ? WHERE id = ?`
        ).run(merged.on_enter, merged.on_exit, merged.quiet_start, merged.quiet_end, merged.days_of_week, merged.window_start, merged.window_end, subId);

        const row = db.prepare(
            `SELECT ps.*, p.name AS place_name, u.display_name AS member_name
             FROM place_subscriptions ps
             JOIN places p ON p.id = ps.place_id
             LEFT JOIN users u ON u.id = ps.member_id
             WHERE ps.id = ?`
        ).get(subId);

        return rowToSub(row);
    });

    fastify.delete('/api/place-subscriptions/:id', { preHandler: requireAuth(db) }, async (req, reply) => {
        const subId = Number(req.params.id);
        if (!Number.isInteger(subId)) return reply.code(400).send({ error: 'invalid_subscription' });

        const existing = db.prepare('SELECT user_id FROM place_subscriptions WHERE id = ?').get(subId);
        if (!existing) return reply.code(404).send({ error: 'not_found' });
        if (existing.user_id !== req.auth.userId) return reply.code(403).send({ error: 'not_owner' });

        db.prepare('DELETE FROM place_subscriptions WHERE id = ?').run(subId);
        return { ok: true };
    });
}
