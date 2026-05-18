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
function render(name, vars = {}) {
    let html = view(name);
    for (const [key, value] of Object.entries(vars)) {
        const safe = htmlEscape(String(value ?? ''));
        html = html.split(`{{${key}}}`).join(safe);
        html = html.split(`{{{${key}}}}`).join(String(value ?? ''));
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
        send(reply, render('login.html', { BOOTSTRAP_FLAG: bootstrap ? '1' : '0' }));
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
                        l.lat, l.lng, l.battery_pct AS batteryPct, l.recorded_at AS recordedAt
                 FROM circle_members cm
                 JOIN users u ON u.id = cm.user_id
                 LEFT JOIN locations l ON l.user_id = u.id
                 WHERE cm.circle_id = ?
                 ORDER BY u.display_name COLLATE NOCASE ASC`
            )
            .all(circleRow.circleId);

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

        const initialState = {
            circleId: circleRow.circleId,
            circleName: circleRow.circleName,
            me: { userId: session.userId, displayName: session.displayName, role: circleRow.role },
            members,
            places,
            sosActive,
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
                        cm.role AS role, cm.joined_at AS joinedAt
                 FROM circle_members cm
                 JOIN users u ON u.id = cm.user_id
                 WHERE cm.circle_id = ?
                 ORDER BY cm.role DESC, u.display_name COLLATE NOCASE ASC`
            )
            .all(circleRow.circleId);

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
}
