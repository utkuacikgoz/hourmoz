CREATE TABLE `sponsor_events` (
	`visit_id` text NOT NULL,
	`sponsor_id` text NOT NULL,
	`viewed` integer DEFAULT 0 NOT NULL,
	`clicked` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`visit_id`, `sponsor_id`)
);
