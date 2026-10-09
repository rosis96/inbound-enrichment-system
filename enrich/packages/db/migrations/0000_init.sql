CREATE TYPE "public"."client_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."crawl_source" AS ENUM('fetch', 'firecrawl');--> statement-breakpoint
CREATE TYPE "public"."email_status" AS ENUM('valid', 'invalid', 'catch_all', 'unknown', 'not_found');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('happierleads', 'instantly');--> statement-breakpoint
CREATE TYPE "public"."intent_level" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('received', 'normalised', 'gated_out', 'below_icp', 'no_contact', 'no_valid_email', 'researched', 'personalised', 'awaiting_review', 'approved', 'rejected', 'pushed', 'dry_run_complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."outreach_status" AS ENUM('not_sent', 'queued', 'sent', 'replied', 'bounced', 'unsubscribed', 'interested', 'not_interested', 'meeting_booked');--> statement-breakpoint
CREATE TYPE "public"."prompt_key" AS ENUM('company_summary', 'first_line');--> statement-breakpoint
CREATE TYPE "public"."step_status" AS ENUM('ok', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."suppression_kind" AS ENUM('email', 'domain');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('customer', 'open_deal', 'competitor', 'do_not_contact', 'unsubscribed', 'bounced', 'replied', 'manual');--> statement-breakpoint
CREATE TYPE "public"."suppression_source" AS ENUM('csv', 'instantly', 'manual');--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"auto_approve" boolean DEFAULT false NOT NULL,
	"happierleads_token" text NOT NULL,
	"instantly_webhook_token" text NOT NULL,
	"instantly_api_key_enc" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monthly_budget_usd" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_slug_unique" UNIQUE("slug"),
	CONSTRAINT "clients_happierleads_token_unique" UNIQUE("happierleads_token"),
	CONSTRAINT "clients_instantly_webhook_token_unique" UNIQUE("instantly_webhook_token")
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"source" "event_source" NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"contact_id" uuid,
	"raw_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"campaign_id" text,
	"lead_email" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"name" text,
	"industry" text,
	"employee_range" text,
	"revenue_range" text,
	"country" text,
	"linkedin_url" text,
	"crawl_text" text,
	"crawl_source" "crawl_source",
	"crawled_at" timestamp with time zone,
	"summary" jsonb,
	"summary_model" text,
	"summarised_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_domain_unique" UNIQUE("domain"),
	CONSTRAINT "companies_domain_normalised" CHECK ("companies"."domain" = lower("companies"."domain") and "companies"."domain" not like 'www.%')
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"visited_at" timestamp with time zone,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"referrer" text,
	"session" jsonb,
	"intent_topic" text,
	"intent_level" "intent_level",
	"icp_score" integer,
	"icp_reasons" jsonb,
	"status" "lead_status" DEFAULT 'received' NOT NULL,
	"skip_reason" text,
	"campaign_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_client_raw_event_unique" UNIQUE("client_id","raw_event_id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"full_name" text,
	"title" text,
	"seniority" text,
	"linkedin_url" text,
	"email" text,
	"email_status" "email_status",
	"email_source" text,
	"selected" boolean DEFAULT false NOT NULL,
	"first_line" text,
	"subject_line" text,
	"personalisation_meta" jsonb,
	"instantly_lead_id" text,
	"outreach_status" "outreach_status" DEFAULT 'not_sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrichment_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"contact_id" uuid,
	"step" text NOT NULL,
	"provider" text NOT NULL,
	"status" "step_status" NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"cost_usd" numeric(10, 5) DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppression" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "suppression_kind" NOT NULL,
	"value" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source" "suppression_source" NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppression_client_kind_value_unique" UNIQUE("client_id","kind","value"),
	CONSTRAINT "suppression_value_lowercase" CHECK ("suppression"."value" = lower("suppression"."value"))
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" "prompt_key" NOT NULL,
	"version" integer NOT NULL,
	"template" text NOT NULL,
	"model" text,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompts_key_version_unique" UNIQUE("key","version")
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" text NOT NULL,
	"hostname" text NOT NULL,
	"pid" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_beat_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_heartbeats_worker_id_unique" UNIQUE("worker_id")
);
--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_steps" ADD CONSTRAINT "enrichment_steps_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_steps" ADD CONSTRAINT "enrichment_steps_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_events_client_source_received_idx" ON "raw_events" USING btree ("client_id","source","received_at");--> statement-breakpoint
CREATE INDEX "outreach_events_client_occurred_idx" ON "outreach_events" USING btree ("client_id","occurred_at");--> statement-breakpoint
CREATE INDEX "outreach_events_contact_idx" ON "outreach_events" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "leads_client_status_created_idx" ON "leads" USING btree ("client_id","status","created_at");--> statement-breakpoint
CREATE INDEX "leads_client_company_idx" ON "leads" USING btree ("client_id","company_id");--> statement-breakpoint
CREATE INDEX "contacts_client_email_idx" ON "contacts" USING btree ("client_id","email");--> statement-breakpoint
CREATE INDEX "contacts_lead_idx" ON "contacts" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "enrichment_steps_lead_created_idx" ON "enrichment_steps" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "enrichment_steps_provider_created_idx" ON "enrichment_steps" USING btree ("provider","created_at");