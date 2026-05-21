CREATE TABLE IF NOT EXISTS place_subscriptions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    place_id     INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    member_id    INTEGER          REFERENCES users(id)  ON DELETE CASCADE,
    on_enter     INTEGER NOT NULL DEFAULT 1,
    on_exit      INTEGER NOT NULL DEFAULT 1,
    quiet_start  INTEGER,
    quiet_end    INTEGER,
    created_at   INTEGER NOT NULL,
    UNIQUE(user_id, place_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_place_subs_lookup
    ON place_subscriptions(place_id, member_id);
CREATE INDEX IF NOT EXISTS idx_place_subs_user
    ON place_subscriptions(user_id);
