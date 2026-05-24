ALTER TABLE alert_prefs ADD COLUMN routines_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE alert_prefs ADD COLUMN routines_quiet_start INTEGER;
ALTER TABLE alert_prefs ADD COLUMN routines_quiet_end   INTEGER;
