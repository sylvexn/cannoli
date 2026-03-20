ALTER TABLE `rosters` ADD `cost_at_draft` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `rosters` SET `cost_at_draft` = `tier` WHERE `cost_at_draft` = 0;
