-- Kingambit (best comeback) and Baxcalibur (best sweep) are tied to the match the Pokemon
-- appeared in: the award now collects a match alongside the Pokemon (pins.match_id already exists).
UPDATE `pin_definitions` SET `metadata_fields` = '["pokemon","match"]' WHERE `id` IN ('baxcalibur', 'kingambit');
