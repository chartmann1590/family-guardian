// One-shot WebSocket smoke test:
// - connects to ws://127.0.0.1:8080/ws?token=<TOKEN>
// - logs every frame for 5 seconds, then exits
// Usage: node ws-smoke.mjs <token>
import WebSocket from 'ws';

const token = process.argv[2];
if (!token) { console.error('usage: node ws-smoke.mjs <token>'); process.exit(2); }

const ws = new WebSocket(`ws://127.0.0.1:8080/ws?token=${token}`);
ws.on('open', () => console.log('OPEN'));
ws.on('message', (data) => console.log('MSG ' + data.toString()));
ws.on('close', (code, reason) => { console.log(`CLOSE ${code} ${reason}`); process.exit(0); });
ws.on('error', (err) => { console.error('ERR', err.message); process.exit(1); });

setTimeout(() => ws.close(), 5000);
