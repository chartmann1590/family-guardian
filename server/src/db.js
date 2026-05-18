import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

export function openDb(path) {
    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return db;
}

function runMigrations(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
    )`);
    const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map(r => r.name));
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    const insert = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');
    for (const file of files) {
        if (applied.has(file)) continue;
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
        db.exec('BEGIN');
        try {
            db.exec(sql);
            insert.run(file, Date.now());
            db.exec('COMMIT');
        } catch (err) {
            db.exec('ROLLBACK');
            throw new Error(`Migration ${file} failed: ${err.message}`);
        }
    }
}
