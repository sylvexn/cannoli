-- Coach flair: passive identity expressions surfaced wherever a coach's
-- name renders. Three additions to the users table:
--   * signature_pokemon_id — chosen Pokemon (rendered as a mini sprite next
--     to the coach name in CoachLink). Stores pokemon.id; nullable.
--   * title — short user-set string (≤ 40 chars), e.g. "The Garchomp Curse".
--     Displayed under display_name on the profile page and inside the
--     CoachLink hover popover.
--   * signature_type — Pokemon type accent (renders as a small colored chip
--     near the coach name + optional avatar tint). Validated against the
--     canonical 18-type list at the API layer.
--
-- All three default NULL so existing accounts are untouched.
ALTER TABLE `users` ADD `signature_pokemon_id` integer REFERENCES `pokemon`(`id`);--> statement-breakpoint
ALTER TABLE `users` ADD `title` text;--> statement-breakpoint
ALTER TABLE `users` ADD `signature_type` text;
