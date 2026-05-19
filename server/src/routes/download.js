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
        const base = publicBaseUrl(req);
        reply.header('content-type', 'text/html; charset=utf-8');
        return reply.send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install Family Guardian</title>
<style>
body{margin:0;font-family:ui-rounded,Avenir Next,Inter,system-ui,sans-serif;background:#eef7f0;color:#071b24}
main{max-width:860px;margin:0 auto;padding:32px 18px}
h1{font-size:clamp(32px,7vw,56px);line-height:.95;letter-spacing:-.06em;margin:0 0 12px}
p{color:#53616b;line-height:1.55}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;margin-top:24px}
.card{background:rgba(255,255,255,.86);border:1px solid rgba(7,27,36,.12);border-radius:28px;padding:22px;box-shadow:0 18px 50px rgba(7,27,36,.09)}
a.button{display:inline-block;border-radius:999px;background:#006c49;color:white;font-weight:800;text-decoration:none;padding:12px 16px;margin-top:10px}
a.secondary{background:#dff2e9;color:#073f2f}
code{background:#dff2e9;border-radius:8px;padding:2px 6px}
img{background:white;border-radius:18px;padding:10px;max-width:180px}
</style></head><body><main>
<h1>Install Family Guardian</h1>
<p>Use the Android APK, install the iPhone PWA from Safari, or build the native iOS IPA from GitHub Actions and sideload it with a free Apple ID.</p>
<div class="grid">
  <section class="card"><h2>Android</h2><p>Download and sideload the APK from this server.</p><img src="/download/qr.svg" alt="Android APK QR"><br><a class="button" href="/download/family-guardian.apk">Download APK</a></section>
  <section class="card"><h2>iPhone PWA</h2><p>Open <code>${base}/app</code> in Safari, sign in, then Share -> Add to Home Screen. GPS works while the PWA is open.</p><img src="/download/app-qr.svg" alt="iPhone PWA QR"><br><a class="button" href="/app">Open iPhone web app</a></section>
  <section class="card"><h2>Native iOS sideload</h2><p>Download <code>FamilyGuardian-unsigned.ipa</code> from the GitHub Actions workflow, then sign/install it on Windows with Sideloadly or AltStore.</p><a class="button secondary" href="/docs/ios-native-sideloading.html">Read native instructions</a></section>
</div>
</main></body></html>`);
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

    fastify.get('/download/app-qr.svg', {
        config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    }, async (req, reply) => {
        const url = `${publicBaseUrl(req)}/app`;
        const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 220 });
        reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=300');
        return reply.send(svg);
    });
}
