CREATE TABLE `pending_captures` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text,
	`raw` text NOT NULL,
	`created_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pending_captures_url_idx` ON `pending_captures` (`url`);