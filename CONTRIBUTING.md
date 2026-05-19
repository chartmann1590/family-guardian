# Contributing to Family Guardian

Thanks for your interest! This is an early-stage project; the process is lightweight.

## Setup

```bash
git clone https://github.com/chartmann1590/family-guardian.git
cd family-guardian/server
npm install
npm run dev        # starts on :8080 with a local SQLite DB
```

For Android, open `android/` in Android Studio (Hedgehog+), let Gradle sync, and run on a device or emulator.

## Development

- **Server** is ESM (`"type": "module"`). Local imports use `.js` extensions.
- **SQLite** via better-sqlite3. Migrations auto-run from `server/src/migrations/` in lexical order.
- No test suite yet — we're working on it. If you add a route, exercise it with `curl` against a running dev server.
- No linter or formatter yet. Follow the existing style: 4-space indent, single quotes, no trailing commas, no semicolons.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change. Keep it focused — one feature or fix per PR.
3. If you change the server, verify it boots: `DATABASE_PATH=$(pwd)/data/test.db PORT=8765 npm start`.
4. Open a PR with a clear description of what and why.

## Reporting issues

Open a GitHub issue with steps to reproduce, what you expected, and what actually happened.

## Code of conduct

Be respectful. This is a family safety tool built for everyone.
