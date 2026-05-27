import { lookupSession, extractToken } from '../auth.js';
import { subscribe, unsubscribeAll } from '../hub.js';

export default async function wsRoutes(fastify, { db }) {
    fastify.get('/ws', { websocket: true }, (socket, req) => {
        const token = extractToken(req) || req.query?.token || null;
        const session = lookupSession(db, token);
        if (!session) {
            socket.send(JSON.stringify({ type: 'error', error: 'unauthorized' }));
            socket.close();
            return;
        }

        const circleRows = db
            .prepare('SELECT circle_id AS circleId FROM circle_members WHERE user_id = ?')
            .all(session.userId);

        if (circleRows.length === 0) {
            socket.send(JSON.stringify({ type: 'error', error: 'no_circle' }));
            socket.close();
            return;
        }

        const activeCircleId = db.prepare(
            'SELECT last_circle_id AS id FROM users WHERE id = ?'
        ).get(session.userId)?.id;

        const circleIds = circleRows.map(r => r.circleId);
        const primaryCircleId = activeCircleId && circleIds.includes(activeCircleId)
            ? activeCircleId
            : circleIds[0];

        for (const cid of circleIds) {
            subscribe(cid, socket);
        }

        socket.send(JSON.stringify({ type: 'ready', circleId: primaryCircleId, circles: circleIds }));

        socket.on('close', () => unsubscribeAll(socket));
        socket.on('error', () => unsubscribeAll(socket));
    });
}
