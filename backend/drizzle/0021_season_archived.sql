-- Add `archived` flag on seasons. Distinct from `phase = offseason`:
-- archived seasons require ?force=1 on writes, and tier-list edits are
-- blocked for any league belonging to an archived season.
ALTER TABLE `seasons` ADD `archived` integer DEFAULT 0 NOT NULL;
