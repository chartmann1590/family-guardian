-- low_battery_threshold already exists from migration 010_alerts_prefs.sql; do not re-add.
-- Sprint 7 adds only the new opt-in flag for watcher-side push alerts.
ALTER TABLE alert_prefs ADD COLUMN low_battery_alerts INTEGER NOT NULL DEFAULT 0;
