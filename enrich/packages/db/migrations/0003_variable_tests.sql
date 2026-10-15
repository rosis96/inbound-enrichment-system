CREATE TABLE `variable_tests` (
	`id` char(36) NOT NULL,
	`client_id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`contact` json NOT NULL,
	`plan` json,
	`plan_check` json,
	`plan_error` text,
	`results` json NOT NULL,
	`error` text,
	`model` varchar(100),
	`cost_usd` decimal(10,5) NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `variable_tests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `variable_tests` ADD CONSTRAINT `variable_tests_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `variable_tests` ADD CONSTRAINT `variable_tests_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `variable_tests_client_created_idx` ON `variable_tests` (`client_id`,`created_at`);