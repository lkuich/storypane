ALTER TABLE spaces ALTER COLUMN preview_parameter SET DEFAULT 'storypane_preview';
UPDATE spaces SET preview_parameter = 'storypane_preview' WHERE preview_parameter = 'blok_preview';
