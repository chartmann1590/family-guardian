import { createReadStream, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APK_PATH = join(__dirname, '..', '..', 'downloads', 'family-guardian.apk');

function publicBaseUrl(req) {
    const fwdProto = req.headers['x-forwarded-proto'];
    const fwdHost = req.headers['x-forwarded-host'];
    const proto = (typeof fwdProto === 'string' ? fwdProto.split(',')[0].trim() : null) || req.protocol || 'http';
    const host = (typeof fwdHost === 'string' ? fwdHost.split(',')[0].trim() : null) || req.headers.host;
    return `${proto}://${host}`;
}

export default async function downloadRoutes(fastify) {
    fastify.get('/download/family-guardian.apk', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        let stat;
        try {
            stat = statSync(APK_PATH);
        } catch {
            return reply.code(404).send({ error: 'apk_not_built' });
        }
        reply
            .header('content-type', 'application/vnd.android.package-archive')
            .header('content-length', stat.size)
            .header('content-disposition', 'attachment; filename="family-guardian.apk"')
            .header('cache-control', 'public, max-age=300');
        return reply.send(createReadStream(APK_PATH));
    });

    fastify.get('/download', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        return reply.redirect('/download/family-guardian.apk');
    });

    // QR pointing at the APK URL — used by the install modal & how-it-works.
    fastify.get('/download/qr.svg', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const url = `${publicBaseUrl(req)}/download/family-guardian.apk`;
        const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 });
        reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=300');
        return reply.send(svg);
    });
}
