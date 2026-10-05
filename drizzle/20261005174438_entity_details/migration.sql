ALTER TABLE "entity" ADD COLUMN "entity_type" text DEFAULT 'private_limited' NOT NULL;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "company_number" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "company_status" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "incorporated_on" date;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "registered_office" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "sic_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "year_end_day" smallint;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "year_end_month" smallint;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "accounts_next_due_on" date;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "last_accounts_made_up_to" date;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "companies_house_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "accounting_framework" text;--> statement-breakpoint
ALTER TABLE "entity" ADD COLUMN "size_class" text;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_firm_company_number_idx" ON "entity" ("firm_id","company_number");--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_company_number_format" CHECK ("company_number" ~ '^[A-Z0-9]{8}$');--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_year_end_valid" CHECK (("year_end_day" is null and "year_end_month" is null) or ("year_end_day" between 1 and 31 and "year_end_month" between 1 and 12));