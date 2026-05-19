# Security Policy

## Reporting a vulnerability

If you find a security vulnerability in Family Guardian, please report it privately:

**Email:** charles.h.hartmann1@gmail.com

Please do **not** open a public GitHub issue for security vulnerabilities.

## What to include

- A description of the vulnerability
- Steps to reproduce
- The version or commit hash you tested against
- Any potential impact you've identified

## Response timeline

I aim to acknowledge reports within 48 hours and provide a fix or mitigation within 7 days.

## Known security considerations

- The server runs HTTP by default. Use a reverse proxy (Caddy, nginx, Traefik) with TLS in production.
- `SESSION_SECRET` must be changed from the default before deploying.
- The Android app allows cleartext traffic for local development. Switch to HTTPS before deploying outside your LAN.
- Location data is stored unencrypted in SQLite on the server. Protect the host machine.
