import { lookupSession, extractToken } from '../auth.js';
import { subscribe, unsubscribe } from '../hub.js';

export default async function wsRoutes(fastify, { db }) {
    // Auth uses Authorization: Bearer (mobile/HTTP clients) or fg_session
    // cookie (browsers). The legacy ?token=... query param is no longer
    // accepted — it leaked tokens into access logs and Referer headers.
    fastify.get('/ws', { websocket: true }, (socket, req) => {
        const token = extractToken(req);
        const session = lookupSession(db, token);
        if (!session) {
            socket.send(JSON.stringify({ type: 'error', error: 'unauthorized' }));
            socket.close();
            return;
        }
        const circleRow = db
            .prepare('SELECT circle_id AS circleId FROM circle_members WHERE user_id = ? LIMIT 1')
            .get(session.userId);
        const circleId = circleRow?.circleId;
        if (!circleId) {
            socket.send(JSON.stringify({ type: 'error', error: 'no_circle' }));
            socket.close();
            return;
        }

        subscribe(circleId, socket);
        socket.send(JSON.stringify({ type: 'ready', circleId }));

        socket.on('close', () => unsubscribe(circleId, socket));
        socket.on('error', () => unsubscribe(circleId, socket));
    });
}
