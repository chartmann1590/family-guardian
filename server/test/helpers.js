import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'src', 'migrations');

export function createTestDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`);
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const insert = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');
    for (const file of files) {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
        db.exec('BEGIN');
        try {
            db.exec(sql.replace(/^PRAGMA\s+.*$/gm, '').replace(/^\s*BEGIN\s*;?\s*$/gm, '').replace(/^\s*COMMIT\s*;?\s*$/gm, ''));
            insert.run(file, Date.now());
            db.exec('COMMIT');
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    }
    return db;
}

export function seedUser(db, email = 'alice@test.com', displayName = 'Alice') {
    const now = Date.now();
    const hash = '$argon2id$v=19$m=65536,t=3,p=4$fakehash';
    db.prepare(
        'INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)'
    ).run(email, hash, displayName, now);
    const userId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare(
        'INSERT INTO circles (name, owner_id, created_at) VALUES (?, ?, ?)'
    ).run(displayName + "'s Family", userId, now);
    const circleId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare(
        'INSERT INTO circle_members (circle_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    ).run(circleId, userId, 'admin', now);
    return { userId, circleId };
}

export function seedSecondUser(db, circleId, email = 'bob@test.com', displayName = 'Bob') {
    const now = Date.now();
    const hash = '$argon2id$v=19$m=65536,t=3,p=4$fakehash';
    db.prepare(
        'INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)'
    ).run(email, hash, displayName, now);
    const userId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
    db.prepare(
        'INSERT INTO circle_members (circle_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
    ).run(circleId, userId, 'member', now);
    return { userId, circleId };
}
