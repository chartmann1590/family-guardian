import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

import { openDb } from './db.js';
import authRoutes from './routes/auth.js';
import circleRoutes from './routes/circles.js';
import locationRoutes from './routes/locations.js';
import placeRoutes from './routes/places.js';
import sosRoutes from './routes/sos.js';
import wsRoutes from './routes/ws.js';
import webRoutes from './routes/web.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const DB_PATH = process.env.DATABASE_PATH || join(__dirname, '..', 'data', 'guardian.db');
const COOKIE_SECRET = process.env.SESSION_SECRET || 'change-me-in-production-please';

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = openDb(DB_PATH);

const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info' },
    trustProxy: true,
});

await fastify.register(cookie, { secret: COOKIE_SECRET });
await fastify.register(formbody);
await fastify.register(websocket);
await fastify.register(staticPlugin, {
    root: join(__dirname, 'public'),
    prefix: '/public/',
});

await fastify.register(authRoutes, { db });
await fastify.register(circleRoutes, { db });
await fastify.register(locationRoutes, { db });
await fastify.register(placeRoutes, { db });
await fastify.register(sosRoutes, { db });
await fastify.register(wsRoutes, { db });
await fastify.register(webRoutes, { db });

fastify.get('/healthz', async () => ({ ok: true }));

fastify.listen({ host: HOST, port: PORT }).catch((err) => {
    fastify.log.error(err);
    process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        try { await fastify.close(); } finally { db.close(); process.exit(0); }
    });
}
