ALTER TABLE memberships
  ADD COLUMN block_picker_previews boolean NOT NULL DEFAULT true,
  ADD COLUMN block_library_previews boolean NOT NULL DEFAULT true;

UPDATE memberships SET block_picker_previews=block_previews, block_library_previews=block_previews;
