-- Pause sharing: soft pause that freezes the user's last-known location and
-- suppresses the live `location_update` broadcast until expiry. History rows
-- continue to accumulate so the user's own timeline stays intact.

ALTER TABLE users ADD COLUMN paused_until INTEGER;
ALTER TABLE users ADD COLUMN pause_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_users_paused_until
    ON users(paused_until) WHERE paused_until IS NOT NULL;
