CREATE TABLE "entity_role" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"firm_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"started_on" date,
	"ended_on" date,
	"shareholding_percent" numeric(5,2),
	"controls" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_role_unique" UNIQUE NULLS NOT DISTINCT("firm_id","entity_id","person_id","role","started_on"),
	CONSTRAINT "entity_role_dates_in_order" CHECK ("started_on" is null or "ended_on" is null or "ended_on" >= "started_on"),
	CONSTRAINT "entity_role_shareholding_valid" CHECK ("shareholding_percent" is null or ("role" = 'shareholder' and "shareholding_percent" > 0 and "shareholding_percent" <= 100))
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"firm_id" uuid NOT NULL,
	"kind" text DEFAULT 'individual' NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"birth_month" smallint,
	"birth_year" smallint,
	"companies_house_officer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_firm_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "person_name_length" CHECK (length(trim("name")) between 1 and 160),
	CONSTRAINT "person_birth_valid" CHECK (("birth_month" is null or "birth_month" between 1 and 12) and ("birth_year" is null or "birth_year" between 1900 and 2100))
);
--> statement-breakpoint
CREATE INDEX "entity_role_person_idx" ON "entity_role" ("firm_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_firm_officer_idx" ON "person" ("firm_id","companies_house_officer_id");--> statement-breakpoint
CREATE INDEX "person_firm_name_idx" ON "person" ("firm_id","name");--> statement-breakpoint
ALTER TABLE "entity_role" ADD CONSTRAINT "entity_role_entity_fk" FOREIGN KEY ("firm_id","entity_id") REFERENCES "entity"("firm_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity_role" ADD CONSTRAINT "entity_role_person_fk" FOREIGN KEY ("firm_id","person_id") REFERENCES "person"("firm_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_firm_id_tenant_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "tenant"("id") ON DELETE RESTRICT;