import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { randomBytes } from 'node:crypto';

function publicBaseUrl(req) {
    const fwdProto = req.headers['x-forwarded-proto'];
    const fwdHost = req.headers['x-forwarded-host'];
    const proto = (typeof fwdProto === 'string' ? fwdProto.split(',')[0].trim() : null) || req.protocol || 'http';
    const host = (typeof fwdHost === 'string' ? fwdHost.split(',')[0].trim() : null) || req.headers.host;
    return `${proto}://${host}`;
}

function rowToJson(r) {
    return {
        token: r.token,
        userId: r.user_id,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        destination: r.destination_lat != null ? {
            lat: r.destination_lat,
            lng: r.destination_lng,
            label: r.destination_label,
        } : null,
        maxViews: r.max_views,
        viewCount: r.view_count,
        revoked: !!r.revoked,
    };
}

export default async function tripShareRoutes(fastify, { db }) {

    fastify.post('/api/users/me/trip-shares', {
        preHandler: requireAuth(db),
        config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    }, async (req, reply) => {
        const body = z.object({
            durationMinutes: z.number().int().min(1).max(240).default(60),
            destination: z.object({
                lat: z.number().min(-90).max(90),
                lng: z.number().min(-180).max(180),
                label: z.string().max(128).optional(),
            }).optional(),
            maxViews: z.number().int().min(1).max(1000).optional(),
        }).safeParse(req.body);
        if (!body.success) return reply.code(400).send({ error: 'invalid_body', details: body.error.flatten() });

        const userId = req.auth.userId;
        const activeCount = db.prepare(
            `SELECT COUNT(*) AS c FROM trip_share_tokens WHERE user_id = ? AND revoked = 0 AND expires_at > ?`
        ).get(userId, Date.now())?.c ?? 0;
        if (activeCount >= 10) return reply.code(429).send({ error: 'too_many_active_shares' });

        const now = Date.now();
        const token = randomBytes(16).toString('base64url');
        const expiresAt = now + body.data.durationMinutes * 60 * 1000;

        db.prepare(`
            INSERT INTO trip_share_tokens (token, user_id, created_at, expires_at, destination_lat, destination_lng, destination_label, max_views)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            token, userId, now, expiresAt,
            body.data.destination?.lat ?? null,
            body.data.destination?.lng ?? null,
            body.data.destination?.label ?? null,
            body.data.maxViews ?? null,
        );

        const url = `${publicBaseUrl(req)}/share/${token}`;

        return { token, url, expiresAt };
    });

    fastify.get('/api/users/me/trip-shares', { preHandler: requireAuth(db) }, async (req) => {
        const rows = db.prepare(`
            SELECT * FROM trip_share_tokens
            WHERE user_id = ? AND (revoked = 0 OR revoked_at > ?)
            ORDER BY created_at DESC LIMIT 20
        `).all(req.auth.userId, Date.now() - 24 * 60 * 60 * 1000);
        return { shares: rows.map(rowToJson) };
    });

    fastify.delete('/api/trip-shares/:token', { preHandler: requireAuth(db) }, async (req, reply) => {
        const token = req.params.token;
        const row = db.prepare('SELECT * FROM trip_share_tokens WHERE token = ?').get(token);
        if (!row) return reply.code(404).send({ error: 'not_found' });
        if (row.user_id !== req.auth.userId) return reply.code(403).send({ error: 'not_owner' });
        db.prepare('UPDATE trip_share_tokens SET revoked = 1 WHERE token = ?').run(token);
        return { ok: true };
    });

    fastify.get('/share/:token', async (req, reply) => {
        const token = req.params.token;
        const row = db.prepare('SELECT * FROM trip_share_tokens WHERE token = ?').get(token);
        if (!row || row.revoked || row.expires_at < Date.now()) {
            return reply.code(410).type('text/html').send('<h1>Link expired or revoked</h1>');
        }
        if (row.max_views != null && row.view_count >= row.max_views) {
            return reply.code(410).type('text/html').send('<h1>Link expired or revoked</h1>');
        }
        return reply.type('text/html').send(sharePageHtml(token));
    });

    fastify.get('/share/:token/loc', async (req, reply) => {
        const token = req.params.token;
        const row = db.prepare('SELECT * FROM trip_share_tokens WHERE token = ?').get(token);
        if (!row || row.revoked || row.expires_at < Date.now()) {
            return reply.code(410).send({ error: 'expired' });
        }
        if (row.max_views != null && row.view_count >= row.max_views) {
            return reply.code(410).send({ error: 'expired' });
        }

        const user = db.prepare('SELECT id, display_name, photo_path, paused_until FROM users WHERE id = ?').get(row.user_id);
        if (user && user.paused_until && user.paused_until > Date.now()) {
            return reply.code(423).send({ error: 'sharing_paused', message: 'Location sharing is paused' });
        }

        db.prepare('UPDATE trip_share_tokens SET view_count = view_count + 1 WHERE token = ?').run(token);

        const loc = db.prepare(
            'SELECT lat, lng, recorded_at FROM locations WHERE user_id = ?'
        ).get(row.user_id);

        const result = {
            displayName: user?.display_name || 'User',
            lat: loc?.lat ?? null,
            lng: loc?.lng ?? null,
            recordedAt: loc?.recorded_at ?? null,
        };

        if (row.destination_lat != null) {
            result.destination = {
                lat: row.destination_lat,
                lng: row.destination_lng,
                label: row.destination_label,
            };
        }

        return result;
    });
}

function sharePageHtml(token) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Live Location Share</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,sans-serif;background:#F8F9FF;color:#1B1B1F}
#map{width:100%;height:70vh}
.info{padding:16px;text-align:center}
.info h2{font-size:18px;margin-bottom:4px}
.info p{color:#49454F;font-size:14px}
.pill{display:inline-block;background:#D3E3FD;color:#004AC6;border-radius:999px;padding:2px 10px;font-size:12px;margin-top:8px}
</style>
</head>
<body>
<div id="map"></div>
<div class="info">
  <h2 id="name">Loading...</h2>
  <p id="updated"></p>
  <span class="pill" id="status">Live</span>
</div>
<script>
(function(){
  var token = ${JSON.stringify(token)};
  var map = L.map('map').setView([0,0],2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'OSM'}).addTo(map);
  var marker, destMarker, line;

  function fetchLoc(){
    fetch('/share/'+token+'/loc').then(function(r){
      if(!r.ok){document.getElementById('status').textContent='Expired';return null}
      return r.json();
    }).then(function(d){
      if(!d||d.lat==null) return;
      document.getElementById('name').textContent=d.displayName||'User';
      var ago=Math.round((Date.now()-d.recordedAt)/1000);
      document.getElementById('updated').textContent='Last updated '+ago+'s ago';
      var ll=[d.lat,d.lng];
      if(!marker){marker=L.marker(ll).addTo(map);map.setView(ll,14)}
      else marker.setLatLng(ll);
      if(d.destination){
        var dl=[d.destination.lat,d.destination.lng];
        if(!destMarker){destMarker=L.marker(dl,{icon:L.divIcon({className:'',html:'<div style="font-size:24px">&#x1F3AF;</div>',iconSize:[24,24],iconAnchor:[12,12]})}).addTo(map)}
        else destMarker.setLatLng(dl);
        if(!line) line=L.polyline([ll,dl],{color:'#006C49',dashArray:'6 8'}).addTo(map);
        else line.setLatLngs([ll,dl]);
        map.fitBounds(L.latLngBounds(ll,dl),{padding:[40,40]});
      }
    }).catch(function(){});
  }
  fetchLoc();
  setInterval(fetchLoc,10000);
})();
</script>
</body>
</html>`;
}
