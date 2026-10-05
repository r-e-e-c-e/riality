ALTER TABLE "client" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "key_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "risk_rating" text;--> statement-breakpoint
ALTER TABLE "client" ADD COLUMN "last_reviewed_on" date;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_partner_membership_fk" FOREIGN KEY ("firm_id","partner_id") REFERENCES "tenant_membership"("tenant_id","user_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_manager_membership_fk" FOREIGN KEY ("firm_id","manager_id") REFERENCES "tenant_membership"("tenant_id","user_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_key_contact_fk" FOREIGN KEY ("firm_id","key_contact_id") REFERENCES "person"("firm_id","id") ON DELETE RESTRICT;