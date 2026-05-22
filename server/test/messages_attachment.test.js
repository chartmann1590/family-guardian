import { describe, it, expect } from 'vitest';
import { createTestDb, seedUser, seedSecondUser } from './helpers.js';
import { stripJpegExif, stripImageMetadata, isAllowedImageMime, isAllowedAudioMime } from '../src/exifStrip.js';

function makeJpegWithExif() {
    const parts = [];
    parts.push(Buffer.from([0xff, 0xd8]));
    const exifPayload = Buffer.from('Exif\x00\x00GPS data here');
    const segLen = exifPayload.length + 2;
    const seg = Buffer.alloc(2 + segLen);
    seg[0] = 0xff;
    seg[1] = 0xe1;
    seg.writeUInt16BE(segLen, 2);
    exifPayload.copy(seg, 4);
    parts.push(seg);
    const sosData = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x00, 0x00, 0x42, 0x43]);
    parts.push(sosData);
    return Buffer.concat(parts);
}

describe('message_attachments migration', () => {
    it('adds attachment columns to messages table', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at, attachment_kind, attachment_mime, attachment_bytes, attachment_duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(circleId, userId, 'voice note', Date.now(), 'audio', 'audio/mp4', 12345, 5000);

        const row = db.prepare('SELECT * FROM messages WHERE body = ?').get('voice note');
        expect(row.attachment_kind).toBe('audio');
        expect(row.attachment_mime).toBe('audio/mp4');
        expect(row.attachment_bytes).toBe(12345);
        expect(row.attachment_duration_ms).toBe(5000);
    });

    it('allows NULL attachment columns for text-only messages', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at) VALUES (?, ?, ?, ?)'
        ).run(circleId, userId, 'plain text', Date.now());

        const row = db.prepare('SELECT * FROM messages WHERE body = ?').get('plain text');
        expect(row.attachment_kind).toBeNull();
        expect(row.attachment_path).toBeNull();
    });

    it('rejects invalid attachment_kind', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        expect(() => {
            db.prepare(
                'INSERT INTO messages (circle_id, user_id, body, created_at, attachment_kind) VALUES (?, ?, ?, ?, ?)'
            ).run(circleId, userId, 'bad', Date.now(), 'video');
        }).toThrow();
    });

    it('stores image attachment metadata', () => {
        const db = createTestDb();
        const { userId, circleId } = seedUser(db);
        db.prepare(
            'INSERT INTO messages (circle_id, user_id, body, created_at, attachment_kind, attachment_mime, attachment_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(circleId, userId, 'photo', Date.now(), 'image', 'image/jpeg', 89000);

        const row = db.prepare('SELECT * FROM messages WHERE body = ?').get('photo');
        expect(row.attachment_kind).toBe('image');
        expect(row.attachment_mime).toBe('image/jpeg');
        expect(row.attachment_bytes).toBe(89000);
        expect(row.attachment_duration_ms).toBeNull();
    });
});

describe('exifStrip', () => {
    it('removes APP1 segment from JPEG', () => {
        const jpeg = makeJpegWithExif();
        const stripped = stripJpegExif(jpeg);
        expect(stripped[0]).toBe(0xff);
        expect(stripped[1]).toBe(0xd8);
        expect(stripped.length).toBeLessThan(jpeg.length);
        let offset = 2;
        let foundApp1 = false;
        while (offset < stripped.length - 1) {
            if (stripped[offset] !== 0xff) break;
            const marker = stripped[offset + 1];
            if (marker === 0xe1) foundApp1 = true;
            if (marker === 0xda) break;
            const segLen = stripped.readUInt16BE(offset + 2);
            offset += 2 + segLen;
        }
        expect(foundApp1).toBe(false);
    });

    it('passes through non-JPEG buffer unchanged', () => {
        const buf = Buffer.from('not a jpeg');
        expect(stripImageMetadata({ buffer: buf, mime: 'image/png' })).toBe(buf);
        expect(stripImageMetadata({ buffer: buf, mime: 'image/webp' })).toBe(buf);
    });

    it('strips JPEG when mime is image/jpeg', () => {
        const jpeg = makeJpegWithExif();
        const result = stripImageMetadata({ buffer: jpeg, mime: 'image/jpeg' });
        expect(result.length).toBeLessThan(jpeg.length);
    });
});

describe('mime allowlists', () => {
    it('allows correct image types', () => {
        expect(isAllowedImageMime('image/jpeg')).toBe(true);
        expect(isAllowedImageMime('image/png')).toBe(true);
        expect(isAllowedImageMime('image/webp')).toBe(true);
        expect(isAllowedImageMime('image/gif')).toBe(false);
    });

    it('allows correct audio types', () => {
        expect(isAllowedAudioMime('audio/mp4')).toBe(true);
        expect(isAllowedAudioMime('audio/aac')).toBe(true);
        expect(isAllowedAudioMime('audio/m4a')).toBe(true);
        expect(isAllowedAudioMime('audio/x-m4a')).toBe(true);
        expect(isAllowedAudioMime('audio/webm')).toBe(true);
        expect(isAllowedAudioMime('audio/ogg')).toBe(false);
    });
});
