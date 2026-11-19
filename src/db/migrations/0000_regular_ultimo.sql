CREATE TABLE `api_cache` (
	`provider` text NOT NULL,
	`request_hash` text NOT NULL,
	`response` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`provider`, `request_hash`)
);
--> statement-breakpoint
CREATE TABLE `chat` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`summary_of` text
);
--> statement-breakpoint
CREATE TABLE `enrichment` (
	`listing_id` integer PRIMARY KEY NOT NULL,
	`commute_transit_min` integer,
	`route_steps` text,
	`commute_bike_min` integer,
	`nearest_stop` text,
	`stop_walk_min` integer,
	`rush_headway_min` integer,
	`pois` text,
	`cost_breakdown` text,
	`all_in_monthly` integer,
	`all_in_plus_transit` integer,
	`scam_checks` text,
	`review_summary` text,
	`computed_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `facts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`field` text NOT NULL,
	`value` text,
	`provenance` text NOT NULL,
	`source_url` text,
	`checked_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `facts_listing_field_idx` ON `facts` (`listing_id`,`field`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`verdict` text NOT NULL,
	`my_words` text,
	`weight_changes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feedback_listing_idx` ON `feedback` (`listing_id`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`url` text,
	`raw_text` text,
	`type` text,
	`address` text,
	`lat` real,
	`lng` real,
	`city` text,
	`status` text DEFAULT 'New' NOT NULL,
	`first_seen` text NOT NULL,
	`last_checked` text
);
--> statement-breakpoint
CREATE TABLE `photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`url` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photos_listing_idx` ON `photos` (`listing_id`);--> statement-breakpoint
CREATE TABLE `preferences` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`value` text,
	`weight` real,
	`set_by` text,
	`history` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `roommates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`listing_id` integer NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'Messaged' NOT NULL,
	`notes` text,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `roommates_listing_idx` ON `roommates` (`listing_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
