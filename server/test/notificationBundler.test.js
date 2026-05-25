import { describe, it, expect, vi } from 'vitest';
import { BundlingBuffer } from '../src/lib/notificationBundler.js';

describe('BundlingBuffer', () => {
    it('calls flush with collected events after timeout', async () => {
        vi.useFakeTimers();
        const flushed = [];
        const buf = new BundlingBuffer(1000);
        buf.enqueue('key1', { a: 1 }, (key, events) => flushed.push({ key, events }));
        buf.enqueue('key1', { a: 2 }, (key, events) => flushed.push({ key, events }));
        expect(flushed).toHaveLength(0);
        vi.advanceTimersByTime(1001);
        expect(flushed).toHaveLength(1);
        expect(flushed[0].key).toBe('key1');
        expect(flushed[0].events).toHaveLength(2);
        buf.clear();
        vi.useRealTimers();
    });

    it('batches separate keys independently', async () => {
        vi.useFakeTimers();
        const flushed = [];
        const buf = new BundlingBuffer(500);
        buf.enqueue('a', { x: 1 }, (key, events) => flushed.push({ key, events }));
        buf.enqueue('b', { y: 1 }, (key, events) => flushed.push({ key, events }));
        vi.advanceTimersByTime(501);
        expect(flushed).toHaveLength(2);
        expect(flushed[0].key).toBe('a');
        expect(flushed[1].key).toBe('b');
        buf.clear();
        vi.useRealTimers();
    });

    it('clear discards all pending events', () => {
        vi.useFakeTimers();
        const flushed = [];
        const buf = new BundlingBuffer(1000);
        buf.enqueue('k', { v: 1 }, (key, events) => flushed.push({ key, events }));
        buf.clear();
        vi.advanceTimersByTime(2000);
        expect(flushed).toHaveLength(0);
        vi.useRealTimers();
    });
});
