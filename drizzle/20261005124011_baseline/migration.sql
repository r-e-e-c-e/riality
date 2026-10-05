CREATE TYPE "engagement_role" AS ENUM('auditor', 'manager', 'partner');--> statement-breakpoint
CREATE TYPE "credential_purpose" AS ENUM('signup', 'reset');--> statement-breakpoint
CREATE TYPE "membership_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "tenant_kind" AS ENUM('group', 'firm');--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"action" text NOT NULL,
	"actor_id" uuid,
	"operator_name" text,
	"tenant_id" uuid,
	"engagement_id" uuid,
	"subject_user_id" uuid,
	"target_type" text,
	"target_id" uuid,
	"details" jsonb DEFAULT '{}' NOT NULL,
	"session_id" uuid,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_has_one_actor" CHECK (("actor_id" is not null and "operator_name" is null) or ("actor_id" is null and "operator_name" is not null and length(trim("operator_name")) > 0))
);
--> statement-breakpoint
CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_firm_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "client_name_length" CHECK (length(trim("name")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "entity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"firm_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_firm_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "entity_name_length" CHECK (length(trim("name")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "engagement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"firm_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"type" text DEFAULT 'statutory_audit' NOT NULL,
	"stage" text DEFAULT 'setup' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_firm_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "engagement_period_unique" UNIQUE("firm_id","period_id"),
	CONSTRAINT "engagement_type_v1" CHECK ("type" = 'statutory_audit'),
	CONSTRAINT "engagement_stage_setup" CHECK ("stage" = 'setup')
);
--> statement-breakpoint
CREATE TABLE "reporting_period" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"firm_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "period_firm_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "period_entity_dates_unique" UNIQUE("firm_id","entity_id","starts_on","ends_on"),
	CONSTRAINT "period_dates_ordered" CHECK ("starts_on" <= "ends_on")
);
--> statement-breakpoint
CREATE TABLE "engagement_team" (
	"firm_id" uuid,
	"engagement_id" uuid,
	"user_id" uuid,
	"role" "engagement_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_team_pkey" PRIMARY KEY("firm_id","engagement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "credential_token" (
	"token_hash" text PRIMARY KEY,
	"purpose" "credential_purpose" NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_credential" (
	"user_id" uuid PRIMARY KEY,
	"encrypted_secret" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_step" bigint DEFAULT -1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_code" (
	"user_id" uuid,
	"code_hash" text,
	CONSTRAINT "mfa_recovery_code_pkey" PRIMARY KEY("user_id","code_hash")
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY,
	"attempts" integer NOT NULL,
	"resets_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"token_hash" text PRIMARY KEY,
	"id" uuid DEFAULT uuidv7() NOT NULL UNIQUE,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"email" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_normalized_email" CHECK ("email" = lower(trim("email")))
);
--> statement-breakpoint
CREATE TABLE "mail_outbox" (
	"id" uuid PRIMARY KEY,
	"encrypted_message" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_invitation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"token_hash" text NOT NULL UNIQUE,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "membership_role" NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_membership" (
	"tenant_id" uuid,
	"user_id" uuid,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_membership_pkey" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"kind" "tenant_kind" NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_not_own_parent" CHECK ("parent_id" is null or "parent_id" <> "id"),
	CONSTRAINT "tenant_name_length" CHECK (length(trim("name")) between 1 and 160)
);
--> statement-breakpoint
CREATE INDEX "audit_event_tenant_idx" ON "audit_event" ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_engagement_idx" ON "audit_event" ("engagement_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_target_idx" ON "audit_event" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_event_subject_idx" ON "audit_event" ("subject_user_id");--> statement-breakpoint
CREATE INDEX "engagement_team_user_idx" ON "engagement_team" ("firm_id","user_id");--> statement-breakpoint
CREATE INDEX "credential_expiry_idx" ON "credential_token" ("expires_at");--> statement-breakpoint
CREATE INDEX "credential_user_idx" ON "credential_token" ("user_id");--> statement-breakpoint
CREATE INDEX "rate_limit_expiry_idx" ON "rate_limit" ("resets_at");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "auth_session" ("user_id");--> statement-breakpoint
CREATE INDEX "session_expiry_idx" ON "auth_session" ("expires_at");--> statement-breakpoint
CREATE INDEX "mail_available_idx" ON "mail_outbox" ("available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_tenant_email_idx" ON "tenant_invitation" ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "invitation_expiry_idx" ON "tenant_invitation" ("expires_at");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "tenant_membership" ("user_id");--> statement-breakpoint
CREATE INDEX "tenant_parent_idx" ON "tenant" ("parent_id");--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_actor_id_app_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_subject_user_id_app_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_firm_id_tenant_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "tenant"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "entity" ADD CONSTRAINT "entity_client_fk" FOREIGN KEY ("firm_id","client_id") REFERENCES "client"("firm_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "engagement" ADD CONSTRAINT "engagement_period_fk" FOREIGN KEY ("firm_id","period_id") REFERENCES "reporting_period"("firm_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "reporting_period" ADD CONSTRAINT "period_entity_fk" FOREIGN KEY ("firm_id","entity_id") REFERENCES "entity"("firm_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "engagement_team" ADD CONSTRAINT "team_engagement_fk" FOREIGN KEY ("firm_id","engagement_id") REFERENCES "engagement"("firm_id","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "engagement_team" ADD CONSTRAINT "team_membership_fk" FOREIGN KEY ("firm_id","user_id") REFERENCES "tenant_membership"("tenant_id","user_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credential_token" ADD CONSTRAINT "credential_token_user_id_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mfa_credential" ADD CONSTRAINT "mfa_credential_user_id_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_user_id_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_invitation" ADD CONSTRAINT "tenant_invitation_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "tenant_invitation" ADD CONSTRAINT "tenant_invitation_invited_by_app_user_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "app_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_tenant_id_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_user_id_app_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_parent_id_tenant_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tenant"("id") ON DELETE RESTRICT;