CREATE TABLE `clients` (
	`id` char(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`status` enum('active','paused') NOT NULL DEFAULT 'active',
	`dry_run` boolean NOT NULL DEFAULT true,
	`auto_approve` boolean NOT NULL DEFAULT false,
	`happierleads_token` varchar(64) NOT NULL,
	`instantly_webhook_token` varchar(64) NOT NULL,
	`instantly_api_key_enc` varchar(1024),
	`settings` json NOT NULL,
	`monthly_budget_usd` decimal(12,2),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `clients_slug_unique` UNIQUE(`slug`),
	CONSTRAINT `clients_happierleads_token_unique` UNIQUE(`happierleads_token`),
	CONSTRAINT `clients_instantly_webhook_token_unique` UNIQUE(`instantly_webhook_token`)
);
--> statement-breakpoint
CREATE TABLE `raw_events` (
	`id` char(36) NOT NULL,
	`client_id` char(36) NOT NULL,
	`source` enum('happierleads','instantly') NOT NULL,
	`payload` json NOT NULL,
	`received_at` datetime(3) NOT NULL,
	`processed_at` datetime(3),
	`error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `raw_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `outreach_events` (
	`id` char(36) NOT NULL,
	`client_id` char(36) NOT NULL,
	`contact_id` char(36),
	`raw_event_id` char(36) NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`campaign_id` varchar(64),
	`lead_email` varchar(320),
	`occurred_at` datetime(3) NOT NULL,
	`payload` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `outreach_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` char(36) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`name` varchar(255),
	`industry` varchar(255),
	`employee_range` varchar(50),
	`revenue_range` varchar(50),
	`country` varchar(100),
	`linkedin_url` varchar(500),
	`crawl_text` text,
	`crawl_source` enum('fetch','firecrawl'),
	`crawled_at` datetime(3),
	`summary` json,
	`summary_model` varchar(100),
	`summarised_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `companies_id` PRIMARY KEY(`id`),
	CONSTRAINT `companies_domain_unique` UNIQUE(`domain`),
	CONSTRAINT `companies_domain_normalised` CHECK(`companies`.`domain` = lower(`companies`.`domain`) and `companies`.`domain` not like 'www.%')
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` char(36) NOT NULL,
	`client_id` char(36) NOT NULL,
	`company_id` char(36) NOT NULL,
	`raw_event_id` char(36) NOT NULL,
	`visited_at` datetime(3),
	`pages` json NOT NULL,
	`referrer` text,
	`session` json,
	`intent_topic` varchar(255),
	`intent_level` enum('high','medium','low'),
	`icp_score` int,
	`icp_reasons` json,
	`status` enum('received','normalised','gated_out','below_icp','no_contact','no_valid_email','researched','personalised','awaiting_review','approved','rejected','pushed','dry_run_complete','failed') NOT NULL DEFAULT 'received',
	`skip_reason` text,
	`campaign_id` varchar(64),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`),
	CONSTRAINT `leads_client_raw_event_unique` UNIQUE(`client_id`,`raw_event_id`)
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` char(36) NOT NULL,
	`lead_id` char(36) NOT NULL,
	`client_id` char(36) NOT NULL,
	`first_name` varchar(255),
	`last_name` varchar(255),
	`full_name` varchar(255),
	`title` varchar(255),
	`seniority` varchar(50),
	`linkedin_url` varchar(500),
	`email` varchar(320),
	`email_status` enum('valid','invalid','catch_all','unknown','not_found'),
	`email_source` varchar(100),
	`selected` boolean NOT NULL DEFAULT false,
	`first_line` text,
	`subject_line` varchar(255),
	`personalisation_meta` json,
	`instantly_lead_id` varchar(64),
	`outreach_status` enum('not_sent','queued','sent','replied','bounced','unsubscribed','interested','not_interested','meeting_booked') NOT NULL DEFAULT 'not_sent',
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `contacts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `enrichment_steps` (
	`id` char(36) NOT NULL,
	`lead_id` char(36) NOT NULL,
	`contact_id` char(36),
	`step` varchar(50) NOT NULL,
	`provider` varchar(100) NOT NULL,
	`status` enum('ok','skipped','failed') NOT NULL,
	`input` json,
	`output` json,
	`error` text,
	`cost_usd` decimal(10,5) NOT NULL DEFAULT 0,
	`duration_ms` int,
	`attempt` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `enrichment_steps_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `suppression` (
	`id` char(36) NOT NULL,
	`client_id` char(36) NOT NULL,
	`kind` enum('email','domain') NOT NULL,
	`value` varchar(320) NOT NULL,
	`reason` enum('customer','open_deal','competitor','do_not_contact','unsubscribed','bounced','replied','manual') NOT NULL,
	`source` enum('csv','instantly','manual') NOT NULL,
	`expires_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `suppression_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppression_client_kind_value_unique` UNIQUE(`client_id`,`kind`,`value`),
	CONSTRAINT `suppression_value_lowercase` CHECK(`suppression`.`value` = lower(`suppression`.`value`))
);
--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` char(36) NOT NULL,
	`key` enum('company_summary','first_line') NOT NULL,
	`version` int NOT NULL,
	`template` text NOT NULL,
	`model` varchar(100),
	`active` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `prompts_id` PRIMARY KEY(`id`),
	CONSTRAINT `prompts_key_version_unique` UNIQUE(`key`,`version`)
);
--> statement-breakpoint
CREATE TABLE `worker_heartbeats` (
	`id` char(36) NOT NULL,
	`worker_id` varchar(200) NOT NULL,
	`hostname` varchar(255) NOT NULL,
	`pid` int NOT NULL,
	`started_at` datetime(3) NOT NULL,
	`last_beat_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `worker_heartbeats_id` PRIMARY KEY(`id`),
	CONSTRAINT `worker_heartbeats_worker_id_unique` UNIQUE(`worker_id`)
);
--> statement-breakpoint
CREATE TABLE `admin_users` (
	`id` char(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`password_hash` varchar(100) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `admin_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_users_email_unique` UNIQUE(`email`),
	CONSTRAINT `admin_users_email_lowercase` CHECK(`admin_users`.`email` = lower(`admin_users`.`email`))
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` char(36) NOT NULL,
	`queue` varchar(64) NOT NULL,
	`data` json NOT NULL,
	`state` enum('created','active','completed','failed') NOT NULL DEFAULT 'created',
	`retry_count` int NOT NULL DEFAULT 0,
	`retry_limit` int NOT NULL,
	`start_after` datetime(3) NOT NULL,
	`claim_token` varchar(36),
	`locked_by` varchar(200),
	`locked_at` datetime(3),
	`last_error` text,
	`completed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `raw_events` ADD CONSTRAINT `raw_events_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outreach_events` ADD CONSTRAINT `outreach_events_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outreach_events` ADD CONSTRAINT `outreach_events_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `outreach_events` ADD CONSTRAINT `outreach_events_raw_event_id_raw_events_id_fk` FOREIGN KEY (`raw_event_id`) REFERENCES `raw_events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `leads` ADD CONSTRAINT `leads_raw_event_id_raw_events_id_fk` FOREIGN KEY (`raw_event_id`) REFERENCES `raw_events`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_lead_id_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `contacts` ADD CONSTRAINT `contacts_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `enrichment_steps` ADD CONSTRAINT `enrichment_steps_lead_id_leads_id_fk` FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `enrichment_steps` ADD CONSTRAINT `enrichment_steps_contact_id_contacts_id_fk` FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `suppression` ADD CONSTRAINT `suppression_client_id_clients_id_fk` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `raw_events_client_source_received_idx` ON `raw_events` (`client_id`,`source`,`received_at`);--> statement-breakpoint
CREATE INDEX `outreach_events_client_occurred_idx` ON `outreach_events` (`client_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `outreach_events_contact_idx` ON `outreach_events` (`contact_id`);--> statement-breakpoint
CREATE INDEX `leads_client_status_created_idx` ON `leads` (`client_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `leads_client_company_idx` ON `leads` (`client_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `contacts_client_email_idx` ON `contacts` (`client_id`,`email`);--> statement-breakpoint
CREATE INDEX `contacts_lead_idx` ON `contacts` (`lead_id`);--> statement-breakpoint
CREATE INDEX `enrichment_steps_lead_created_idx` ON `enrichment_steps` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `enrichment_steps_provider_created_idx` ON `enrichment_steps` (`provider`,`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_queue_state_start_idx` ON `jobs` (`queue`,`state`,`start_after`);--> statement-breakpoint
CREATE INDEX `jobs_claim_token_idx` ON `jobs` (`claim_token`);--> statement-breakpoint
CREATE INDEX `jobs_state_locked_idx` ON `jobs` (`state`,`locked_at`);