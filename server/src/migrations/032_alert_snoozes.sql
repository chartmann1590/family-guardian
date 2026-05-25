CREATE TABLE IF NOT EXISTS alert_snoozes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    alert_type TEXT    NOT NULL CHECK(alert_type IN ('geofence_enter','geofence_exit','speeding','low_battery','offline','routine_deviation','curfew_violation','visit_end','trip_end')),
    snooze_until INTEGER NOT NULL,
    PRIMARY KEY (user_id, alert_type)
);
