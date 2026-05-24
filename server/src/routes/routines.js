import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { logView } from '../audit.js';
import { getUpcomingRoutines } from '../routines.js';

function assertMember(db, circleId, userId, reply) {
    const m = db
        .prepare('SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?')
        .get(circleId, userId);
    if (!m) { reply.code(403).send({ error: 'not_a_member' }); return false; }
    return true;
}

function routineRowToJson(r) {
    return {
        id: r.id,
        userId: r.user_id,
        circleId: r.circle_id,
        placeId: r.place_id,
        placeName: r.place_name,
        kind: r.kind,
        dayOfWeek: r.day_of_week,
        expectedMinute: r.expected_minute,
        toleranceMinutes: r.tolerance_minutes,
        sampleCount: r.sample_count,
        confidence: Math.round(r.confidence * 100) / 100,
        source: r.source,
        active: !!r.active,
        firstSeenAt: r.first_seen_at,
        lastSeenAt: r.last_seen_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

const PatchRoutine = z.object({
    active: z.boolean().optional(),
    toleranceMinutes: z.number().int().min(5).max(180).optional(),
    expectedMinute: z.number().int().min(0).max(1439).optional(),
});

const RoutinePrefsPatch = z.object({
    routinesEnabled: z.boolean().optional(),
    quietStart: z.number().int().min(0).max(1439).nullable().optional(),
    quietEnd: z.number().int().min(0).max(1439).nullable().optional(),
});

const CreateRoutine = z.object({
    placeId: z.number().int(),
    kind: z.enum(['arrival', 'departure']),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    expectedMinute: z.number().int().min(0).max(1439),
    toleranceMinutes: z.number().int().min(5).max(180),
});

export default async function routineRoutes(fastify, { db }) {
    fastify.get('/api/users/:userId/routines', { preHandler: requireAuth(db) }, async (req, reply) => {
        const subjectId = Number(req.params.userId);
        if (!Number.isInteger(subjectId)) return reply.code(400).send({ error: 'invalid_user' });

        const callerCircle = db
            .prepare('SELECT circle_id FROM circle_members WHERE user_id = ? LIMIT 1')
            .get(req.auth.userId);
        const subjectCircle = db
            .prepare('SELECT circle_id FROM circle_members WHERE user_id = ? LIMIT 1')
            .get(subjectId);
        if (!callerCircle || !subjectCircle || callerCircle.circle_id !== subjectCircle.circle_id) {
            return reply.code(403).send({ error: 'not_same_circle' });
        }

        logView(db, req.auth.userId, subjectId, 'routines');

        const rows = db.prepare(`
            SELECT r.*, p.name AS place_name
            FROM routines r
            JOIN places p ON p.id = r.place_id
            WHERE r.user_id = ?
            ORDER BY r.day_of_week, r.kind, r.expected_minute
        `).all(subjectId);

        return { routines: rows.map(routineRowToJson) };
    });

    fastify.patch('/api/routines/:id', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const routineId = Number(req.params.id);
        if (!Number.isInteger(routineId)) return reply.code(400).send({ error: 'invalid_id' });

        const parsed = PatchRoutine.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

        const routine = db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId);
        if (!routine) return reply.code(404).send({ error: 'not_found' });

        const callerCircle = db
            .prepare('SELECT circle_id, role FROM circle_members WHERE user_id = ? LIMIT 1')
            .get(req.auth.userId);
        const isSubject = routine.user_id === req.auth.userId;
        const callerAdmin = callerCircle?.role === 'admin' && callerCircle?.circle_id === routine.circle_id;
        if (!isSubject && !callerAdmin) return reply.code(403).send({ error: 'forbidden' });

        const updates = [];
        const params = [];
        const data = parsed.data;

        if (data.active !== undefined) {
            updates.push('active = ?');
            params.push(data.active ? 1 : 0);
            if (!data.active) {
                updates.push("source = 'manual'");
            }
        }
        if (data.toleranceMinutes !== undefined) {
            updates.push('tolerance_minutes = ?');
            params.push(data.toleranceMinutes);
            updates.push("source = 'manual'");
        }
        if (data.expectedMinute !== undefined) {
            updates.push('expected_minute = ?');
            params.push(data.expectedMinute);
            updates.push("source = 'manual'");
        }

        if (updates.length) {
            updates.push('updated_at = ?');
            params.push(Date.now());
            params.push(routineId);
            db.prepare(`UPDATE routines SET ${updates.join(', ')} WHERE id = ?`).run(...params);
        }

        const updated = db.prepare(`
            SELECT r.*, p.name AS place_name
            FROM routines r JOIN places p ON p.id = r.place_id
            WHERE r.id = ?
        `).get(routineId);
        return routineRowToJson(updated);
    });

    fastify.delete('/api/routines/:id', { preHandler: requireAuth(db) }, async (req, reply) => {
        const routineId = Number(req.params.id);
        if (!Number.isInteger(routineId)) return reply.code(400).send({ error: 'invalid_id' });

        const routine = db.prepare('SELECT * FROM routines WHERE id = ?').get(routineId);
        if (!routine) return reply.code(404).send({ error: 'not_found' });

        const callerCircle = db
            .prepare('SELECT circle_id, role FROM circle_members WHERE user_id = ? LIMIT 1')
            .get(req.auth.userId);
        const isSubject = routine.user_id === req.auth.userId;
        const callerAdmin = callerCircle?.role === 'admin' && callerCircle?.circle_id === routine.circle_id;
        if (!isSubject && !callerAdmin) return reply.code(403).send({ error: 'forbidden' });

        db.prepare("UPDATE routines SET active = 0, source = 'manual', updated_at = ? WHERE id = ?")
            .run(Date.now(), routineId);

        return { ok: true };
    });

    fastify.get('/api/users/me/routine-prefs', { preHandler: requireAuth(db) }, async (req) => {
        let prefs = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(req.auth.userId);
        if (!prefs) {
            db.prepare('INSERT INTO alert_prefs (user_id) VALUES (?)').run(req.auth.userId);
            prefs = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(req.auth.userId);
        }
        return {
            routinesEnabled: !!prefs.routines_enabled,
            quietStart: prefs.routines_quiet_start,
            quietEnd: prefs.routines_quiet_end,
        };
    });

    fastify.patch('/api/users/me/routine-prefs', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const parsed = RoutinePrefsPatch.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

        db.prepare('INSERT OR IGNORE INTO alert_prefs (user_id) VALUES (?)').run(req.auth.userId);

        const updates = [];
        const params = [];
        const data = parsed.data;

        if (data.routinesEnabled !== undefined) {
            updates.push('routines_enabled = ?');
            params.push(data.routinesEnabled ? 1 : 0);
        }
        if (data.quietStart !== undefined) {
            updates.push('routines_quiet_start = ?');
            params.push(data.quietStart);
        }
        if (data.quietEnd !== undefined) {
            updates.push('routines_quiet_end = ?');
            params.push(data.quietEnd);
        }

        if (updates.length) {
            params.push(req.auth.userId);
            db.prepare(`UPDATE alert_prefs SET ${updates.join(', ')} WHERE user_id = ?`).run(...params);
        }

        const prefs = db.prepare('SELECT * FROM alert_prefs WHERE user_id = ?').get(req.auth.userId);
        return {
            routinesEnabled: !!prefs.routines_enabled,
            quietStart: prefs.routines_quiet_start,
            quietEnd: prefs.routines_quiet_end,
        };
    });

    fastify.get('/api/circles/:circleId/expected-arrivals', { preHandler: requireAuth(db) }, async (req, reply) => {
        const circleId = Number(req.params.circleId);
        if (!Number.isInteger(circleId)) return reply.code(400).send({ error: 'invalid_circle' });
        if (!assertMember(db, circleId, req.auth.userId, reply)) return;

        const within = Math.min(Number(req.query.within) || 240, 1440);
        const arrivals = getUpcomingRoutines(db, circleId, within);
        return { arrivals };
    });

    fastify.post('/api/users/me/routines', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const parsed = CreateRoutine.safeParse(req.body);
        if (!parsed.success) return reply.code(400).send({ error: 'invalid_body', details: parsed.error.flatten() });

        const callerCircle = db
            .prepare('SELECT circle_id FROM circle_members WHERE user_id = ? LIMIT 1')
            .get(req.auth.userId);
        if (!callerCircle) return reply.code(403).send({ error: 'no_circle' });

        const place = db.prepare('SELECT * FROM places WHERE id = ? AND circle_id = ?')
            .get(parsed.data.placeId, callerCircle.circle_id);
        if (!place) return reply.code(400).send({ error: 'invalid_place' });

        const now = Date.now();
        const insertStmt = db.prepare(`
            INSERT INTO routines (user_id, circle_id, place_id, kind, day_of_week,
                                  expected_minute, tolerance_minutes, sample_count, confidence,
                                  source, active, first_seen_at, last_seen_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 'manual', 1, NULL, NULL, ?, ?)
            ON CONFLICT (user_id, place_id, kind, day_of_week) DO UPDATE SET
                expected_minute = excluded.expected_minute,
                tolerance_minutes = excluded.tolerance_minutes,
                source = 'manual',
                active = 1,
                confidence = 1,
                updated_at = excluded.updated_at
        `);

        const ids = [];
        db.transaction(() => {
            for (const dow of parsed.data.daysOfWeek) {
                const result = insertStmt.run(
                    req.auth.userId, callerCircle.circle_id, parsed.data.placeId,
                    parsed.data.kind, dow, parsed.data.expectedMinute, parsed.data.toleranceMinutes,
                    now, now,
                );
                ids.push(Number(result.lastInsertRowid));
            }
        })();

        return { ids, count: ids.length };
    });
}
