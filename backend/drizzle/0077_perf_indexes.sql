-- Read-path indexes (additive). matches_status_idx is kept: status-only scans
-- (ps-bot, arena live list) still use it.
CREATE INDEX `matches_league_status_phase_week_idx` ON `matches` (`league_id`,`status`,`phase`,`week`);--> statement-breakpoint
CREATE INDEX `match_pokemon_team_idx` ON `match_pokemon` (`team_id`);--> statement-breakpoint
CREATE INDEX `match_pokemon_name_idx` ON `match_pokemon` (`pokemon_name`);--> statement-breakpoint
CREATE INDEX `activity_log_timestamp_idx` ON `activity_log` (`timestamp`);--> statement-breakpoint
CREATE INDEX `teams_user_idx` ON `teams` (`user_id`);--> statement-breakpoint
CREATE INDEX `trades_league_idx` ON `trades` (`league_id`);--> statement-breakpoint
CREATE INDEX `player_availability_league_idx` ON `player_availability` (`league_id`);--> statement-breakpoint
CREATE INDEX `match_ready_log_match_idx` ON `match_ready_log` (`match_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);
