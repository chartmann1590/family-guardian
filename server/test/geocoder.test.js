import { describe, it, expect } from 'vitest';
import { createTestDb } from './helpers.js';

// Set the env var BEFORE importing geocoder so its module-level capture sees it.
process.env.NOMINATIM_DISABLED = '1';
const { enqueueGeocode, isDisabled } = await import('../src/geocoder.js');

describe('geocoder', () => {
    it('reports disabled when NOMINATIM_DISABLED is set at import time', () => {
        expect(isDisabled()).toBe(true);
    });

    it('returns null without making an HTTP call when disabled', async () => {
        const db = createTestDb();
        const got = await new Promise((resolve) => enqueueGeocode(db, 47.6, -122.3, resolve));
        expect(got).toBeNull();
    });

    it('serves repeat lookups from the persistent cache', async () => {
        const db = createTestDb();
        db.prepare(
            `INSERT INTO geocode_cache (lat_round, lng_round, label, fetched_at)
             VALUES (?, ?, ?, ?)`,
        ).run(47.6, -122.3, 'Cached Place', Date.now());
        const got = await new Promise((resolve) => enqueueGeocode(db, 47.6, -122.3, resolve));
        expect(got).toBe('Cached Place');
    });
});
