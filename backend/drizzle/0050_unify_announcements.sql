ALTER TABLE `announcements` ADD `surface` text DEFAULT 'bell' NOT NULL;--> statement-breakpoint
ALTER TABLE `announcements` ADD `league_id` text REFERENCES `leagues`(`id`);--> statement-breakpoint
ALTER TABLE `announcements` ADD `target_role` text;--> statement-breakpoint
ALTER TABLE `announcements` ADD `updated_at` text;--> statement-breakpoint
UPDATE `announcements` SET `updated_at` = `created_at` WHERE `updated_at` IS NULL;--> statement-breakpoint
CREATE INDEX `announcements_active_idx` ON `announcements` (`active`);--> statement-breakpoint
CREATE TABLE `announcement_dismissals` (
	`user_id` integer NOT NULL,
	`announcement_id` integer NOT NULL,
	`dismissed_at` text DEFAULT (datetime('now')),
	PRIMARY KEY(`user_id`, `announcement_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `announcements` (`title`, `body`, `link`, `category`, `surface`, `created_by`, `created_at`, `updated_at`, `active`)
SELECT 'Announcement', `announcement`, NULL,
	CASE `announcement_type` WHEN 'warning' THEN 'maintenance' WHEN 'success' THEN 'feature' ELSE 'info' END,
	'both', NULL, (datetime('now')), (datetime('now')), 1
FROM `site_settings`
WHERE `id` = 1 AND `announcement` IS NOT NULL AND trim(`announcement`) <> '';--> statement-breakpoint
ALTER TABLE `site_settings` DROP COLUMN `announcement`;--> statement-breakpoint
ALTER TABLE `site_settings` DROP COLUMN `announcement_type`;
