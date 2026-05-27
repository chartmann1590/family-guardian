ALTER TABLE places ADD COLUMN kind TEXT NOT NULL DEFAULT 'other' CHECK(kind IN ('home','school','work','medical','social','gym','shopping','transit','other'));
