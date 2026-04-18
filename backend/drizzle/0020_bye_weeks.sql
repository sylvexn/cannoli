-- Bye weeks: when a league has an odd number of teams the round-robin
-- generator emits one bye per round. Previously these were silently dropped;
-- now we materialise them so schedule UIs can render a "BYE" row.
CREATE TABLE `bye_weeks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `league_id` text NOT NULL,
  `week` integer NOT NULL,
  `team_id` text NOT NULL,
  FOREIGN KEY (`league_id`) REFERENCES `leagues`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE INDEX `bye_weeks_league_week_idx` ON `bye_weeks` (`league_id`, `week`);
