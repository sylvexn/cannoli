-- Draft order lock: coaches only see the order once staff lock it (or the draft starts).
-- Leagues past predraft that already have an order keep it visible.
ALTER TABLE `leagues` ADD `draft_order_locked` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `leagues` SET `draft_order_locked` = 1 WHERE `draft_order` IS NOT NULL AND `phase` != 'predraft';
