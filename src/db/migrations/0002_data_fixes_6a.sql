CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_messages_created_idx` ON `chat_messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `feedback_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer,
	`reason` text NOT NULL,
	`weights_before` text NOT NULL,
	`weights_after` text NOT NULL,
	`created_at` text NOT NULL,
	`undone_at` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `feedback_events_created_idx` ON `feedback_events` (`created_at`);--> statement-breakpoint
ALTER TABLE `enrichment` ADD `bucket` text;--> statement-breakpoint
ALTER TABLE `enrichment` ADD `score` real;--> statement-breakpoint
ALTER TABLE `facts` ADD `note` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `title` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `user_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `user_status_reason` text;--> statement-breakpoint
ALTER TABLE `transit_stops` ADD `schedule_basis` text;--> statement-breakpoint
ALTER TABLE `transit_stops` ADD `schedule_date` text;--> statement-breakpoint
-- Backfill: copy bucket and score out of the versioned analysis envelope (version 1) that step 5 stored in cost_breakdown.
UPDATE `enrichment` SET `bucket` = json_extract(`cost_breakdown`, '$.bucket'), `score` = json_extract(`cost_breakdown`, '$.score.score') WHERE json_valid(`cost_breakdown`) AND json_extract(`cost_breakdown`, '$.version') = 1 AND json_extract(`cost_breakdown`, '$.bucket') IN ('pass', 'likely', 'needs_info', 'fail');--> statement-breakpoint
-- Backfill: a card title from the first line of the post text, at most 140 characters.
UPDATE `listings` SET `title` = trim(substr(substr(`raw_text`, 1, instr(`raw_text` || char(10), char(10)) - 1), 1, 140)) WHERE `title` IS NULL AND `raw_text` IS NOT NULL AND trim(`raw_text`) <> '';
