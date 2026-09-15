CREATE TABLE `presence` (
	`player_id` text PRIMARY KEY NOT NULL,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_presence_seen` ON `presence` (`seen_at`);--> statement-breakpoint
CREATE TABLE `sponsor_bids` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'checkout' NOT NULL,
	`created_at` integer NOT NULL,
	`session_id` text,
	`payment_intent` text,
	`paid_at` integer,
	`hidden` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bids_status_amount` ON `sponsor_bids` (`status`,`amount`);--> statement-breakpoint
CREATE INDEX `idx_bids_player_created` ON `sponsor_bids` (`player_id`,`created_at`);