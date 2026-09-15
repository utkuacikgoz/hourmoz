CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`source` text NOT NULL,
	`sponsor_id` text,
	`sponsor_viewed` integer DEFAULT 0 NOT NULL,
	`sponsor_clicked` integer DEFAULT 0 NOT NULL,
	`booking_clicked` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_visits_created` ON `visits` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_visits_player_created` ON `visits` (`player_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `runs` ADD `visit_id` text;