CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`mode` text NOT NULL,
	`seed` integer NOT NULL,
	`created_at` integer NOT NULL,
	`submitted` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_runs_player_created` ON `runs` (`player_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `scores` (
	`player_id` text NOT NULL,
	`mode` text NOT NULL,
	`name` text NOT NULL,
	`score` integer NOT NULL,
	`duration` integer NOT NULL,
	`won` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`player_id`, `mode`)
);
--> statement-breakpoint
CREATE INDEX `idx_scores_mode_score` ON `scores` (`mode`,`score`,`created_at`);