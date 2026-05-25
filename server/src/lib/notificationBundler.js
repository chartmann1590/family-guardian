export class BundlingBuffer {
    constructor(flushMs = 60_000) {
        this.flushMs = flushMs;
        this.buffers = new Map();
    }

    enqueue(key, event, flushCallback) {
        let buf = this.buffers.get(key);
        if (!buf) {
            buf = { events: [], timer: null };
            this.buffers.set(key, buf);
        }
        buf.events.push(event);
        if (buf.timer) clearTimeout(buf.timer);
        buf.timer = setTimeout(() => {
            const events = buf.events;
            this.buffers.delete(key);
            if (events.length > 0) flushCallback(key, events);
        }, this.flushMs);
        if (buf.timer.unref) buf.timer.unref();
    }

    clear() {
        for (const buf of this.buffers.values()) {
            if (buf.timer) clearTimeout(buf.timer);
        }
        this.buffers.clear();
    }
}
