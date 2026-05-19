// Rate-limited reverse geocoder backed by Nominatim, with a persistent cache.
//
// Nominatim ToS: max 1 req/sec, custom User-Agent, no bulk geocoding. We
// queue requests and pace them; results are cached by (lat,lng) rounded to
// 4 decimals (~11m) both in memory (LRU) and in the geocode_cache table.
//
// Disabled entirely if env NOMINATIM_DISABLED is truthy. Callers still get
// the callback invoked, just with label = null.

const MIN_INTERVAL_MS = 1100;
const LRU_LIMIT = 500;
const CACHE_TTL_MS = 30 * 24 * 3600_000;
// Nominatim rejects User-Agents containing obviously-fake contact info
// (anything @example.invalid, etc.), so we ship a clean app-identifying string
// by default. Self-hosters should override via NOMINATIM_USER_AGENT to identify
// their deployment.
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'family-guardian/0.1';
const ENDPOINT = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/reverse';

const disabled = !!process.env.NOMINATIM_DISABLED;
const lru = new Map();      // key -> { label, fetchedAt }
const queue = [];           // { key, lat, lng, db, cb }
let pumpScheduled = false;
let lastFetchAt = 0;

function roundKey(lat, lng) {
    return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function lruGet(key) {
    const v = lru.get(key);
    if (!v) return null;
    lru.delete(key);
    lru.set(key, v);
    return v;
}

function lruPut(key, val) {
    if (lru.has(key)) lru.delete(key);
    lru.set(key, val);
    if (lru.size > LRU_LIMIT) {
        const oldestKey = lru.keys().next().value;
        lru.delete(oldestKey);
    }
}

function cacheLookup(db, key, latR, lngR) {
    const memHit = lruGet(key);
    if (memHit && Date.now() - memHit.fetchedAt < CACHE_TTL_MS) return memHit;
    const row = db.prepare(
        'SELECT label, fetched_at AS fetchedAt FROM geocode_cache WHERE lat_round = ? AND lng_round = ?',
    ).get(latR, lngR);
    if (row && Date.now() - row.fetchedAt < CACHE_TTL_MS) {
        lruPut(key, row);
        return row;
    }
    return null;
}

function cacheStore(db, latR, lngR, label) {
    const now = Date.now();
    db.prepare(
        `INSERT INTO geocode_cache (lat_round, lng_round, label, fetched_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(lat_round, lng_round) DO UPDATE SET
            label = excluded.label, fetched_at = excluded.fetched_at`,
    ).run(latR, lngR, label, now);
    lruPut(`${latR},${lngR}`, { label, fetchedAt: now });
}

/**
 * Asynchronously look up a label for (lat, lng). The callback is called with
 * the label string (or null) once a result is available. Cached lookups
 * resolve synchronously on the next microtask.
 */
export function enqueueGeocode(db, lat, lng, cb) {
    const latR = Number(lat.toFixed(4));
    const lngR = Number(lng.toFixed(4));
    const key = `${latR},${lngR}`;
    const hit = cacheLookup(db, key, latR, lngR);
    if (hit) {
        queueMicrotask(() => cb(hit.label ?? null));
        return;
    }
    if (disabled) {
        queueMicrotask(() => cb(null));
        return;
    }
    queue.push({ key, latR, lngR, db, cb });
    schedulePump();
}

function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastFetchAt));
    setTimeout(pump, wait);
}

async function pump() {
    pumpScheduled = false;
    const item = queue.shift();
    if (!item) return;
    try {
        const url = `${ENDPOINT}?format=json&lat=${item.latR}&lon=${item.lngR}&zoom=16&addressdetails=0`;
        const res = await fetch(url, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        lastFetchAt = Date.now();
        if (res.ok) {
            const body = await res.json();
            const label = body && typeof body.display_name === 'string' ? body.display_name : null;
            cacheStore(item.db, item.latR, item.lngR, label);
            item.cb(label);
        } else {
            item.cb(null);
        }
    } catch {
        item.cb(null);
    }
    if (queue.length > 0) schedulePump();
}

export function getCachedLabel(db, lat, lng) {
    const latR = Number(lat.toFixed(4));
    const lngR = Number(lng.toFixed(4));
    const key = `${latR},${lngR}`;
    const hit = cacheLookup(db, key, latR, lngR);
    return hit ? (hit.label ?? null) : null;
}

export function isDisabled() {
    return disabled;
}
