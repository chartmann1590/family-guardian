ALTER TABLE alert_prefs ADD COLUMN digest_day_of_week INTEGER DEFAULT 0;
ALTER TABLE alert_prefs ADD COLUMN digest_hour_local  INTEGER DEFAULT 18;
ALTER TABLE alert_prefs ADD COLUMN digest_timezone     TEXT    DEFAULT 'Etc/UTC';
