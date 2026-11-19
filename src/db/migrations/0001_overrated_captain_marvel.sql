CREATE TABLE `channel_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel` text NOT NULL,
	`group_name` text,
	`ran_at` text NOT NULL,
	`items_seen` integer NOT NULL,
	`items_new` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `channel_runs_channel_ran_idx` ON `channel_runs` (`channel`,`ran_at`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_key` text NOT NULL,
	`attempted_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_client_idx` ON `login_attempts` (`client_key`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `roommate_leads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`post_url` text,
	`poster_name` text,
	`poster_profile_url` text,
	`group_name` text,
	`text` text,
	`dates_wanted` text,
	`budget_cents` integer,
	`status` text DEFAULT 'new' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transit_stops` (
	`stop_id` text NOT NULL,
	`feed` text NOT NULL,
	`name` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`modes` text NOT NULL,
	`weekday_rush_departures` integer NOT NULL,
	`median_rush_headway_min` integer,
	`computed_at` text NOT NULL,
	PRIMARY KEY(`feed`, `stop_id`)
);
--> statement-breakpoint
DROP INDEX `facts_listing_field_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `facts_listing_field_provenance_idx` ON `facts` (`listing_id`,`field`,`provenance`);--> statement-breakpoint
ALTER TABLE `listings` ADD `post_type` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `listings` ADD `group_name` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `poster_profile_url` text;--> statement-breakpoint
ALTER TABLE `listings` ADD `source_links` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `photos` ADD `phash` text;