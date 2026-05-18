// In-memory pub/sub for location updates, keyed by circle id.
// Each WebSocket subscribes to one circle and receives JSON events.

const subscribers = new Map(); // circleId -> Set<WebSocket>

export function subscribe(circleId, socket) {
    let set = subscribers.get(circleId);
    if (!set) {
        set = new Set();
        subscribers.set(circleId, set);
    }
    set.add(socket);
}

export function unsubscribe(circleId, socket) {
    const set = subscribers.get(circleId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) subscribers.delete(circleId);
}

export function publish(circleId, event) {
    const set = subscribers.get(circleId);
    if (!set) return;
    const payload = JSON.stringify(event);
    for (const socket of set) {
        if (socket.readyState === 1) {
            try { socket.send(payload); } catch { /* ignore */ }
        }
    }
}
