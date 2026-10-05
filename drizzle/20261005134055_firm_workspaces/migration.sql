ALTER TABLE "app_user" ADD COLUMN "avatar_color" text DEFAULT 'teal' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "last_firm_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_handle_key" UNIQUE("handle");--> statement-breakpoint
-- Existing firms get a unique placeholder handle; owners can change it in Settings.
UPDATE "tenant" SET "handle" = 'firm-' || left(replace("id"::text, '-', ''), 12) WHERE "kind" = 'firm' AND "handle" IS NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_last_firm_id_tenant_id_fkey" FOREIGN KEY ("last_firm_id") REFERENCES "tenant"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_handle_format" CHECK ("handle" is null or ("handle" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and length("handle") between 3 and 40));--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_firm_has_handle" CHECK ("kind" <> 'firm' or "handle" is not null);