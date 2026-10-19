ALTER TABLE `leads` MODIFY COLUMN `status` enum('received','normalised','gated_out','below_icp','no_contact','no_valid_email','researched','personalised','awaiting_review','approved','rejected','pushed','dry_run_complete','failed','suppressed') NOT NULL DEFAULT 'received';--> statement-breakpoint
ALTER TABLE `suppression` MODIFY COLUMN `reason` enum('customer','open_deal','competitor','do_not_contact','unsubscribed','bounced','replied','meeting_booked','form_submitted','manual') NOT NULL;--> statement-breakpoint
ALTER TABLE `suppression` MODIFY COLUMN `source` enum('csv','instantly','manual','webhook') NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `blocklist_token` varchar(64);--> statement-breakpoint
ALTER TABLE `suppression` ADD `note` varchar(500);--> statement-breakpoint
ALTER TABLE `suppression` ADD `instantly_entry_id` varchar(64);--> statement-breakpoint
ALTER TABLE `suppression` ADD `instantly_checked_at` datetime(3);--> statement-breakpoint
ALTER TABLE `suppression` ADD `instantly_error` text;--> statement-breakpoint
ALTER TABLE `clients` ADD CONSTRAINT `clients_blocklist_token_unique` UNIQUE(`blocklist_token`);--> statement-breakpoint
CREATE INDEX `suppression_client_instantly_idx` ON `suppression` (`client_id`,`instantly_entry_id`);