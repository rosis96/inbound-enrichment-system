ALTER TABLE `suppression` MODIFY COLUMN `source` enum('csv','instantly','manual','webhook','activecampaign') NOT NULL;--> statement-breakpoint
ALTER TABLE `clients` ADD `activecampaign_api_key_enc` varchar(1024);--> statement-breakpoint
ALTER TABLE `clients` ADD `activecampaign_synced_at` datetime(3);--> statement-breakpoint
ALTER TABLE `clients` ADD `activecampaign_error` text;