-- Notification toggles removed from the UI; drop the unused boolean columns.
ALTER TABLE `user_preferences` DROP COLUMN `notify_trades`;--> statement-breakpoint
ALTER TABLE `user_preferences` DROP COLUMN `notify_matches`;--> statement-breakpoint
ALTER TABLE `user_preferences` DROP COLUMN `notify_announcements`;
