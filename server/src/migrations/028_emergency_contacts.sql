CREATE TABLE IF NOT EXISTS emergency_contacts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
    invited_at      INTEGER NOT NULL,
    accepted_at     INTEGER,
    UNIQUE (user_id, contact_user_id)
);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user    ON emergency_contacts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_contact ON emergency_contacts(contact_user_id, status);
