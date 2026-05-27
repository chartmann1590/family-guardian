import { enqueueGeocode } from './geocoder.js';

export function minePlaceSuggestions(db) {
    const now = Date.now();
    const windowStart = now - 30 * 24 * 60 * 60 * 1000;
    const MIN_VISIT_COUNT = 5;
    const MIN_DWELL_MS = 60 * 60 * 1000;

    const visits = db.prepare(`
        SELECT v.user_id, v.lat, v.lng, v.started_at, v.ended_at
        FROM visits v
        WHERE v.place_id IS NULL
          AND v.started_at > ?
          AND v.ended_at IS NOT NULL
          AND (v.ended_at - v.started_at) >= 300000
    `).all(windowStart);

    const clusters = new Map();
    for (const v of visits) {
        const gridLat = Math.round(v.lat * 1000) / 1000;
        const gridLng = Math.round(v.lng * 1000) / 1000;
        const key = `${v.user_id}:${gridLat}:${gridLng}`;
        if (!clusters.has(key)) {
            clusters.set(key, {
                user_id: v.user_id,
                lat: gridLat,
                lng: gridLng,
                sumLat: 0,
                sumLng: 0,
                visit_count: 0,
                total_dwell_ms: 0,
                first_seen: v.started_at,
                last_seen: v.ended_at,
            });
        }
        const c = clusters.get(key);
        c.sumLat += v.lat;
        c.sumLng += v.lng;
        c.visit_count += 1;
        c.total_dwell_ms += (v.ended_at - v.started_at);
        if (v.started_at < c.first_seen) c.first_seen = v.started_at;
        if (v.ended_at > c.last_seen) c.last_seen = v.ended_at;
    }

    let created = 0;
    for (const c of clusters.values()) {
        if (c.visit_count < MIN_VISIT_COUNT || c.total_dwell_ms < MIN_DWELL_MS) continue;

        const avgLat = c.sumLat / c.visit_count;
        const avgLng = c.sumLng / c.visit_count;

        const existing = db.prepare(
            `SELECT id, status FROM place_suggestions
             WHERE user_id = ? AND round(lat, 3) = round(?, 3) AND round(lng, 3) = round(?, 3)`
        ).get(c.user_id, c.lat, c.lng);

        if (existing) {
            if (existing.status === 'dismissed') {
                const row = db.prepare('SELECT dismissed_at FROM place_suggestions WHERE id = ?').get(existing.id);
                if (row.dismissed_at && (now - row.dismissed_at) < 90 * 24 * 60 * 60 * 1000) continue;
                db.prepare(
                    `UPDATE place_suggestions SET status = 'pending', visit_count = ?, total_dwell_ms = ?,
                     first_seen = ?, last_seen = ?, dismissed_at = NULL WHERE id = ?`
                ).run(c.visit_count, c.total_dwell_ms, c.first_seen, c.last_seen, existing.id);
            } else if (existing.status === 'pending') {
                db.prepare(
                    `UPDATE place_suggestions SET visit_count = ?, total_dwell_ms = ?,
                     first_seen = ?, last_seen = ? WHERE id = ?`
                ).run(c.visit_count, c.total_dwell_ms, c.first_seen, c.last_seen, existing.id);
            }
            continue;
        }

        const ins = db.prepare(
            `INSERT INTO place_suggestions (user_id, lat, lng, visit_count, total_dwell_ms, first_seen, last_seen, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
        ).run(c.user_id, avgLat, avgLng, c.visit_count, c.total_dwell_ms, c.first_seen, c.last_seen);
        const suggestionId = Number(ins.lastInsertRowid);

        enqueueGeocode(db, avgLat, avgLng, (label) => {
            if (label) {
                try {
                    db.prepare('UPDATE place_suggestions SET label = ? WHERE id = ?').run(label, suggestionId);
                } catch { /* ignore */ }
            }
        });
        created++;
    }

    return { created, totalClusters: clusters.size };
}
