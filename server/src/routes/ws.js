import { lookupSession } from '../auth.js';
import { subscribe, unsubscribe } from '../hub.js';

export default async function wsRoutes(fastify, { db }) {
    fastify.get('/ws', { websocket: true }, (socket, req) => {
        const url = new URL(req.url, 'http://localhost');
        const token = url.searchParams.get('token') || req.cookies?.fg_session;
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
