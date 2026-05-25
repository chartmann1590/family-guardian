ALTER TABLE emergency_contacts ADD COLUMN pending_expires_at INTEGER;
UPDATE emergency_contacts SET pending_expires_at = invited_at + 604800000 WHERE status = 'pending' AND pending_expires_at IS NULL;
