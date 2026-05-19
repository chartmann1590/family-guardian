import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

import { openDb } from './db.js';
import { maybeBootstrapAdmin } from './bootstrap.js';
import authRoutes from './routes/auth.js';
import circleRoutes from './routes/circles.js';
import locationRoutes from './routes/locations.js';
import messageRoutes from './routes/messages.js';
import placeRoutes from './routes/places.js';
import profileRoutes from './routes/profile.js';
import checkinRoutes from './routes/checkins.js';
import sosRoutes from './routes/sos.js';
import visitsRoutes from './routes/visits.js';
import tripsRoutes from './routes/trips.js';
import alertPrefsRoutes from './routes/alertPrefs.js';
import wsRoutes from './routes/ws.js';
import webRoutes from './routes/web.js';
import downloadRoutes from './routes/download.js';
import { loadOpenVisits } from './visits.js';
import { loadOpenTrips } from './trips.js';
import { startScheduler } from './scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const DB_PATH = process.env.DATABASE_PATH || join(__dirname, '..', 'data', 'guardian.db');
const DEFAULT_SECRET = 'change-me-in-production-please';
const COOKIE_SECRET = process.env.SESSION_SECRET || DEFAULT_SECRET;

if (process.env.NODE_ENV === 'production' && COOKIE_SECRET === DEFAULT_SECRET) {
    console.error('FATAL: SESSION_SECRET must be set when NODE_ENV=production.');
    process.exit(1);
}

mkdirSync(dirname(DB_PATH), { recursive: true });

const UPLOADS_DIR = join(dirname(DB_PATH), 'uploads');
mkdirSync(UPLOADS_DIR, { recursive: true });

const db = openDb(DB_PATH);
await maybeBootstrapAdmin(db, {
    info: (data, msg) => console.log(JSON.stringify({ level: 30, msg, ...data })),
    warn: (data, msg) => console.warn(JSON.stringify({ level: 40, msg, ...data })),
});

// Rebuild in-memory caches for the visit/trip engines from any rows left
// open by a prior process. Without this, a restart leaks the open state.
loadOpenVisits(db);
loadOpenTrips(db);

const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL || 'info' },
    trustProxy: true,
    // Cap request bodies; location/chat payloads are tiny, photos use a
    // dedicated multipart route with its own limit.
    bodyLimit: 64 * 1024,
});

await fastify.register(cookie, { secret: COOKIE_SECRET });
await fastify.register(formbody);
// Per-route opt-in so location/chat traffic isn't accidentally throttled.
await fastify.register(rateLimit, { global: false });
await fastify.register(multipart, { limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
await fastify.register(websocket);
await fastify.register(staticPlugin, {
    root: join(__dirname, 'public'),
    prefix: '/public/',
});

await fastify.register(authRoutes, { db });
await fastify.register(circleRoutes, { db });
await fastify.register(locationRoutes, { db });
await fastify.register(placeRoutes, { db });
await fastify.register(profileRoutes, { db, uploadsDir: UPLOADS_DIR });
await fastify.register(sosRoutes, { db });
await fastify.register(checkinRoutes, { db });
await fastify.register(messageRoutes, { db });
await fastify.register(visitsRoutes, { db });
await fastify.register(tripsRoutes, { db });
await fastify.register(alertPrefsRoutes, { db });
await fastify.register(wsRoutes, { db });
await fastify.register(webRoutes, { db });
await fastify.register(downloadRoutes);

fastify.get('/healthz', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    try {
        db.prepare('SELECT 1').get();
        return { ok: true };
    } catch (err) {
        req.log.error({ err }, 'healthz_db_fail');
        return reply.code(503).send({ ok: false, error: 'db_unhealthy' });
    }
});

startScheduler(db, fastify.log);

fastify.listen({ host: HOST, port: PORT }).catch((err) => {
    fastify.log.error(err);
    process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, async () => {
        try { await fastify.close(); } finally { db.close(); process.exit(0); }
    });
}
