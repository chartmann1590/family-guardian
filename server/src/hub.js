const subscribers = new Map();
const socketCircles = new Map();

export function subscribe(circleId, socket) {
    let set = subscribers.get(circleId);
    if (!set) {
        set = new Set();
        subscribers.set(circleId, set);
    }
    set.add(socket);

    if (!socketCircles.has(socket)) socketCircles.set(socket, new Set());
    socketCircles.get(socket).add(circleId);
}

export function unsubscribe(circleId, socket) {
    const set = subscribers.get(circleId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) subscribers.delete(circleId);

    const circles = socketCircles.get(socket);
    if (circles) {
        circles.delete(circleId);
        if (circles.size === 0) socketCircles.delete(socket);
    }
}

export function unsubscribeAll(socket) {
    const circles = socketCircles.get(socket);
    if (!circles) return;
    for (const circleId of circles) {
        const set = subscribers.get(circleId);
        if (set) {
            set.delete(socket);
            if (set.size === 0) subscribers.delete(circleId);
        }
    }
    socketCircles.delete(socket);
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

export function getSubscribedCircles(socket) {
    return socketCircles.get(socket) || new Set();
}
