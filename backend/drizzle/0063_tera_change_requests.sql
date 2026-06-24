ALTER TABLE `fa_requests` ADD `request_type` text DEFAULT 'pickup' NOT NULL;--> statement-breakpoint
ALTER TABLE `fa_requests` ADD `tera_changes` text;