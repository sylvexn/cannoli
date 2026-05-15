-- Clubhouse "surface pass": community-first profile + team personality fields,
-- plus a `last_seen_at` heartbeat column used by the who's-online sidebar
-- widget. All columns nullable / defaulted so existing rows survive without a
-- backfill.
ALTER TABLE `users` ADD `status_message` text;--> statement-breakpoint
ALTER TABLE `users` ADD `banner_url` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `motto` text;--> statement-breakpoint
ALTER TABLE `teams` ADD `captain_note` text;
