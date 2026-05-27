ALTER TABLE circle_members ADD COLUMN nickname TEXT;
ALTER TABLE circle_members ADD COLUMN photo_path TEXT;
ALTER TABLE circle_members ADD COLUMN visibility TEXT NOT NULL DEFAULT 'full' CHECK(visibility IN ('full','approximate','hidden'));
