-- Admin-editable rules text (plain text with preserved newlines, rendered on
-- the public Rules page). NULL means no custom text has been set yet —
-- the frontend falls back to its hard-coded prose when NULL.
ALTER TABLE site_settings ADD COLUMN rules_text text;
