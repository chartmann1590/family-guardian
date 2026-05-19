-- Phase 1.1: profile photos. Path is relative to the uploads directory
-- (alongside guardian.db). NULL means "no photo set; render initials".
ALTER TABLE users ADD COLUMN photo_path TEXT;
