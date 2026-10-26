-- Kingslayer / Flawless removed. pins.pin_def_id is ON DELETE CASCADE, so a bare
-- DELETE here would silently destroy awarded pins before curate-pins-migration.ts
-- can export them. Only drop a definition that nothing references; where pins
-- exist (live), the curate script exports, deletes the pins, then the defs.
DELETE FROM `pin_definitions`
  WHERE `id` IN ('kingslayer', 'flawless')
    AND NOT EXISTS (SELECT 1 FROM `pins` WHERE `pins`.`pin_def_id` = `pin_definitions`.`id`);
