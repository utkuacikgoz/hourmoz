CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`bucket` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`key`, `bucket`)
);
--> statement-breakpoint
CREATE INDEX `idx_rate_bucket` ON `rate_limits` (`bucket`);--> statement-breakpoint
ALTER TABLE `runs` ADD `rules` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_runs_created` ON `runs` (`created_at`);