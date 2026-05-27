ALTER TABLE users ADD COLUMN last_circle_id INTEGER REFERENCES circles(id);
