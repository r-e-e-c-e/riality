CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"firm_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL UNIQUE,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "document_firm_id_unique" UNIQUE("firm_id","id"),
	CONSTRAINT "document_title_length" CHECK (length(trim("title")) between 1 and 200),
	CONSTRAINT "document_size_positive" CHECK ("size_bytes" > 0),
	CONSTRAINT "document_removed_complete" CHECK (("removed_at" is null) = ("removed_by" is null))
);
--> statement-breakpoint
CREATE INDEX "document_entity_idx" ON "document" ("firm_id","entity_id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_uploaded_by_app_user_id_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "app_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_removed_by_app_user_id_fkey" FOREIGN KEY ("removed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_entity_fk" FOREIGN KEY ("firm_id","entity_id") REFERENCES "entity"("firm_id","id") ON DELETE RESTRICT;