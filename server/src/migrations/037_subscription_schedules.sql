ALTER TABLE place_subscriptions ADD COLUMN days_of_week INTEGER DEFAULT 127;
ALTER TABLE place_subscriptions ADD COLUMN window_start INTEGER;
ALTER TABLE place_subscriptions ADD COLUMN window_end INTEGER;
