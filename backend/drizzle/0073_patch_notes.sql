-- Patch notes: structured, versioned "What's New" entries (sections, optional hero,
-- hotfixes nested under a parent patch, draft -> published). Existing rows are
-- converted from the dashed `body` by migrateChangelogStructure() at boot (idempotent).
-- Directed notifications gain a bell-tab category (trades / matches / admin / feedback).
ALTER TABLE `changelog` ADD `version` text;--> statement-breakpoint
ALTER TABLE `changelog` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `changelog` ADD `sections` text;--> statement-breakpoint
ALTER TABLE `changelog` ADD `hero_url` text;--> statement-breakpoint
ALTER TABLE `changelog` ADD `status` text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `category` text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
UPDATE `notifications` SET `category` = CASE
  WHEN `type` = 'feedback' THEN 'feedback'
  WHEN `link` LIKE '%free-agents%' OR `link` LIKE '%/admin/trades%' OR `dedupe_key` LIKE 'trade:%'
    OR `dedupe_key` LIKE 'tera:%' OR `dedupe_key` LIKE 'fa:%' THEN 'trades'
  ELSE 'admin' END;
