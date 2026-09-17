CREATE TABLE `sponsor_days` (
	`day` text NOT NULL,
	`test_mode` integer DEFAULT 0 NOT NULL,
	`slot_id` text NOT NULL,
	PRIMARY KEY(`day`, `test_mode`)
);
--> statement-breakpoint
CREATE INDEX `idx_days_slot` ON `sponsor_days` (`slot_id`);--> statement-breakpoint
CREATE TABLE `sponsor_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`start_day` text NOT NULL,
	`days` integer NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'checkout' NOT NULL,
	`test_mode` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`session_id` text,
	`payment_intent` text,
	`paid_at` integer,
	`hidden` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_slots_status_start` ON `sponsor_slots` (`status`,`start_day`);--> statement-breakpoint
CREATE INDEX `idx_slots_player_created` ON `sponsor_slots` (`player_id`,`created_at`);