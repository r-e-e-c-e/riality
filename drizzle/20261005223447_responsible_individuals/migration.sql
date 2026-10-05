ALTER TABLE "tenant_membership" ADD COLUMN "responsible_individual_since" date;--> statement-breakpoint
ALTER TABLE "tenant_membership" ADD COLUMN "audit_regulator" text;--> statement-breakpoint
ALTER TABLE "tenant_membership" ADD CONSTRAINT "membership_ri_complete" CHECK (("responsible_individual_since" is null) = ("audit_regulator" is null));