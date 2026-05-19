import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupSession, extractToken } from '../auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(__dirname, '..', 'views');

const cache = new Map();
function view(name) {
    if (cache.has(name)) return cache.get(name);
    const html = readFileSync(join(VIEWS_DIR, name), 'utf8');
    cache.set(name, html);
    return html;
}

// Minimal {{KEY}} replacement. Values are HTML-escaped unless wrapped {{{KEY}}}.
// IMPORTANT: replace the raw {{{KEY}}} form *before* the safe {{KEY}} form;
// otherwise the safe split matches inside the triple-curly form and corrupts
// any value injected into a <script> tag (the `{{{` becomes `{`, the closing
// `}}}` becomes `}`, and the JSON's outer `{` `}` collide to produce `{{…}}`).
function render(name, vars = {}) {
    let html = view(name);
    for (const [key, value] of Object.entries(vars)) {
        const raw = String(value ?? '');
        html = html.split(`{{{${key}}}}`).join(raw);
        html = html.split(`{{${key}}}`).join(htmlEscape(raw));
    }
    return html;
}

function htmlEscape(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function send(reply, body) {
    reply.header('content-type', 'text/html; charset=utf-8').send(body);
}

export default async function webRoutes(fastify, { db }) {
    fastify.get('/', async (req, reply) => {
        const session = lookupSession(db, extractToken(req));
        if (session) return reply.redirect('/dashboard');
        const bootstrap = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
        if (bootstrap) return reply.redirect('/setup');
        send(reply, render('login.html', { BOOTSTRAP_FLAG: '0' }));
    });

    fastify.get('/setup', async (req, reply) => {
        const bootstrap = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
        if (!bootstrap) return reply.redirect('/');
        send(reply, render('setup.html'));
    });

    fastify.get('/how-it-works', async (req, reply) => {
        send(reply, render('how-it-works.html'));
    });

    fastify.get('/join', async (req, reply) => {
        const code = String(req.query?.code || '').trim();
        if (!code) return reply.redirect('/');
        send(reply, render('join.html', {
            INVITE_CODE: code,
        }));
    });

    fastify.get('/welcome', async (req, reply) => {
        const session = lookupSession(db, extractToken(req));
        if (!session) return reply.redirect('/');
        const circleRow = db
            .prepare(
                `SELECT c.id AS circleId, c.name AS circleName, cm.role AS role
                 FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
                 WHERE cm.user_id = ? LIMIT 1`,
            )
            .get(session.userId);
        if (!circleRow) return reply.code(500).send('User has no circle.');

        const userRow = db
            .prepare('SELECT photo_path AS photoPath FROM users WHERE id = ?')
            .get(session.userId);

        const initialState = {
            circleId: circleRow.circleId,
            circleName: circleRow.circleName,
            me: {
                userId: session.userId,
                displayName: session.displayName,
                photoUrl: userRow?.photoPath ? `/api/users/${session.userId}/photo` : null,
                isAdmin: circleRow.role === 'admin',
            },
        };

        send(
            reply,
            render('welcome.html', {
                DISPLAY_NAME: session.displayName,
                CIRCLE_NAME: circleRow.circleName,
                INITIAL_STATE_JSON: JSON.stringify(initialState).replace(/</g, '\\u003c'),
            }),
        );
    });

    fastify.get('/dashboard', async (req, reply) => {
        const session = lookupSession(db, extractToken(req));
        if (!session) return reply.redirect('/');

        const circleRow = db
            .prepare(
                `SELECT c.id AS circleId, c.name AS circleName, cm.role AS role
                 FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
                 WHERE cm.user_id = ? LIMIT 1`
            )
            .get(session.userId);

        if (!circleRow) {
            return reply.code(500).send('User has no circle. Re-signup needed.');
        }

        const members = db
            .prepare(
                `SELECT u.id AS userId, u.display_name AS displayName,
                        u.photo_path AS photoPath,
                        l.lat, l.lng, l.battery_pct AS batteryPct, l.recorded_at AS recordedAt
                 FROM circle_members cm
                 JOIN users u ON u.id = cm.user_id
                 LEFT JOIN locations l ON l.user_id = u.id
                 WHERE cm.circle_id = ?
                 ORDER BY u.display_name COLLATE NOCASE ASC`
            )
            .all(circleRow.circleId)
            .map(({ photoPath, ...m }) => ({
                ...m,
                photoUrl: photoPath ? `/api/users/${m.userId}/photo` : null,
            }));

        const places = db
            .prepare(
                `SELECT id, name, lat, lng, radius_m AS radiusM, alerts_on_enter AS alertsOnEnter,
                        alerts_on_exit AS alertsOnExit
                 FROM places WHERE circle_id = ? ORDER BY name COLLATE NOCASE`
            )
            .all(circleRow.circleId)
            .map((p) => ({
                ...p,
                alertsOnEnter: !!p.alertsOnEnter,
                alertsOnExit: !!p.alertsOnExit,
            }));

        const sosActive = db
            .prepare(
                `SELECT e.id, e.user_id AS userId, u.display_name AS displayName,
                        e.started_at AS startedAt, e.lat, e.lng, e.note
                 FROM sos_events e JOIN users u ON u.id = e.user_id
                 WHERE e.circle_id = ? AND e.status = 'active'
                 ORDER BY e.started_at DESC`
            )
            .all(circleRow.circleId);

        const latestCheckins = db
            .prepare(
                `SELECT c.user_id AS userId, c.status, c.created_at AS createdAt
                 FROM check_ins c
                 INNER JOIN (
                     SELECT user_id, MAX(created_at) AS max_at
                     FROM check_ins WHERE circle_id = ?
                     GROUP BY user_id
                 ) latest ON c.user_id = latest.user_id AND c.created_at = latest.max_at`
            )
            .all(circleRow.circleId);

        const initialState = {
            circleId: circleRow.circleId,
            circleName: circleRow.circleName,
            me: { userId: session.userId, displayName: session.displayName, role: circleRow.role },
            members,
            places,
            sosActive,
            latestCheckins,
        };

        send(
            reply,
            render('dashboard.html', {
                CIRCLE_NAME: circleRow.circleName,
                DISPLAY_NAME: session.displayName,
                INITIAL_STATE_JSON: JSON.stringify(initialState).replace(/</g, '\\u003c'),
            })
        );
    });

    fastify.get('/chat', async (req, reply) => {
        const session = lookupSession(db, extractToken(req));
        if (!session) return reply.redirect('/');
        const circleRow = db
            .prepare(
                `SELECT c.id AS circleId, c.name AS circleName
                 FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
                 WHERE cm.user_id = ? LIMIT 1`
            )
            .get(session.userId);
        if (!circleRow) return reply.code(500).send('User has no circle.');

        const chatMembers = db
            .prepare(
                `SELECT u.id AS userId, u.display_name AS displayName, u.photo_path AS photoPath
                 FROM circle_members cm
                 JOIN users u ON u.id = cm.user_id
                 WHERE cm.circle_id = ?
                 ORDER BY u.display_name COLLATE NOCASE ASC`
            )
            .all(circleRow.circleId)
            .map(({ photoPath, ...m }) => ({
                ...m,
                photoUrl: photoPath ? `/api/users/${m.userId}/photo` : null,
            }));

        const myPhoto = db
            .prepare('SELECT photo_path AS photoPath FROM users WHERE id = ?')
            .get(session.userId);

        const initialState = {
            circleId: circleRow.circleId,
            circleName: circleRow.circleName,
            me: {
                userId: session.userId,
                displayName: session.displayName,
                photoUrl: myPhoto?.photoPath ? `/api/users/${session.userId}/photo` : null,
            },
            members: chatMembers,
        };

        send(
            reply,
            render('chat.html', {
                CIRCLE_NAME: circleRow.circleName,
                DISPLAY_NAME: session.displayName,
                INITIAL_STATE_JSON: JSON.stringify(initialState).replace(/</g, '\\u003c'),
            })
        );
    });

    fastify.get('/settings', async (req, reply) => {
        const session = lookupSession(db, extractToken(req));
        if (!session) return reply.redirect('/');
        const circleRow = db
            .prepare(
                `SELECT c.id AS circleId, c.name AS circleName, cm.role AS role
                 FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
                 WHERE cm.user_id = ? LIMIT 1`
            )
            .get(session.userId);
        if (!circleRow) return reply.code(500).send('User has no circle.');

        const members = db
            .prepare(
                `SELECT u.id AS userId, u.display_name AS displayName, u.email,
                        u.photo_path AS photoPath,
                        cm.role AS role, cm.joined_at AS joinedAt
                 FROM circle_members cm
                 JOIN users u ON u.id = cm.user_id
                 WHERE cm.circle_id = ?
                 ORDER BY cm.role DESC, u.display_name COLLATE NOCASE ASC`
            )
            .all(circleRow.circleId)
            .map(({ photoPath, ...m }) => ({
                ...m,
                photoUrl: photoPath ? `/api/users/${m.userId}/photo` : null,
            }));

        const initialState = {
            circleId: circleRow.circleId,
            circleName: circleRow.circleName,
            me: { userId: session.userId, displayName: session.displayName, role: circleRow.role },
            members,
            isAdmin: circleRow.role === 'admin',
        };

        send(
            reply,
            render('settings.html', {
                CIRCLE_NAME: circleRow.circleName,
                DISPLAY_NAME: session.displayName,
                INITIAL_STATE_JSON: JSON.stringify(initialState).replace(/</g, '\\u003c'),
            })
        );
    });

    fastify.get('/places', async (req, reply) => {
        const session = lookupSession(db, extractToken(req));
        if (!session) return reply.redirect('/');
        const circleRow = db
            .prepare(
                `SELECT c.id AS circleId, c.name AS circleName
                 FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
                 WHERE cm.user_id = ? LIMIT 1`
            )
            .get(session.userId);
        if (!circleRow) return reply.code(500).send('User has no circle.');

        const places = db
            .prepare(
                `SELECT id, name, address, lat, lng, radius_m AS radiusM,
                        alerts_on_enter AS alertsOnEnter, alerts_on_exit AS alertsOnExit
                 FROM places WHERE circle_id = ? ORDER BY name COLLATE NOCASE`
            )
            .all(circleRow.circleId)
            .map((p) => ({
                ...p,
                alertsOnEnter: !!p.alertsOnEnter,
                alertsOnExit: !!p.alertsOnExit,
            }));

        const initialState = {
            circleId: circleRow.circleId,
            circleName: circleRow.circleName,
            places,
        };

        send(
            reply,
            render('places.html', {
                CIRCLE_NAME: circleRow.circleName,
                DISPLAY_NAME: session.displayName,
                INITIAL_STATE_JSON: JSON.stringify(initialState).replace(/</g, '\\u003c'),
            })
        );
    });

    fastify.get('/member/:userId', async (req, reply) => {
        const session = lookupSession(db, extractToken(req));
        if (!session) return reply.redirect('/');
        const targetUserId = Number(req.params.userId);
        if (!Number.isInteger(targetUserId)) return reply.code(400).send('Invalid user id.');

        const circleRow = db
            .prepare(
                `SELECT c.id AS circleId, c.name AS circleName
                 FROM circle_members cm JOIN circles c ON c.id = cm.circle_id
                 WHERE cm.user_id = ? LIMIT 1`
            )
            .get(session.userId);
        if (!circleRow) return reply.code(500).send('User has no circle.');

        const targetRow = db
            .prepare(
                `SELECT u.id AS userId, u.display_name AS displayName,
                        u.photo_path AS photoPath,
                        l.lat, l.lng, l.accuracy_m AS accuracyM,
                        l.speed_mps AS speedMps, l.battery_pct AS batteryPct,
                        l.recorded_at AS recordedAt
                 FROM circle_members cm
                 JOIN users u ON u.id = cm.user_id
                 LEFT JOIN locations l ON l.user_id = u.id
                 WHERE cm.circle_id = ? AND cm.user_id = ?`
            )
            .get(circleRow.circleId, targetUserId);
        if (!targetRow) return reply.code(404).send('Member not found in your circle.');
        const { photoPath, ...targetMember } = targetRow;
        targetMember.photoUrl = photoPath ? `/api/users/${targetUserId}/photo` : null;

        const initialState = {
            circleId: circleRow.circleId,
            circleName: circleRow.circleName,
            targetUserId,
            member: targetMember,
        };

        send(
            reply,
            render('member.html', {
                CIRCLE_NAME: circleRow.circleName,
                DISPLAY_NAME: targetMember.displayName || 'Member',
                ME_NAME: session.displayName,
                INITIAL_STATE_JSON: JSON.stringify(initialState).replace(/</g, '\\u003c'),
            })
        );
    });
}
