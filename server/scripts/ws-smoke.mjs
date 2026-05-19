// One-shot WebSocket smoke test:
// - connects to ws://127.0.0.1:8080/ws?token=<TOKEN>
// - logs every frame for 5 seconds, then exits
// Usage: node ws-smoke.mjs <token>
import WebSocket from 'ws';

const token = process.argv[2];
if (!token) { console.error('usage: node ws-smoke.mjs <token>'); process.exit(2); }

function safe(s) { return String(s).replace(/[\r\n]/g, ''); }

const ws = new WebSocket(`ws://127.0.0.1:8080/ws?token=${encodeURIComponent(token)}`);
ws.on('open', () => console.log('OPEN'));
ws.on('message', (data) => console.log('MSG ' + safe(data.toString())));
ws.on('close', (code, reason) => { console.log(`CLOSE ${code} ${safe(reason.toString())}`); process.exit(0); });
ws.on('error', (err) => { console.error('ERR', err.message); process.exit(1); });

setTimeout(() => ws.close(), 5000);
