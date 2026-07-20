-- Data fix (feedback #79): Empoleon's hidden ability is Competitive, not
-- Defiant. The reference table was seeded from a spreadsheet that carried the
-- typo. Guarded on the wrong value so it's idempotent and a no-op once fixed.
UPDATE `pokemon` SET `hidden_ability` = 'Competitive' WHERE `name` = 'Empoleon' AND `hidden_ability` = 'Defiant';
