# 0010 — Documents in S3-compatible storage

Status: accepted.

## Decision

Documents (starting with each entity's permanent file) are stored in S3-compatible
object storage: Cloudflare R2 in production, MinIO in Docker locally. The app talks to
it with Bun's built-in S3 client, so there is no new library. A `document` row holds
the description (title, section, file name, content type, size, SHA-256, uploader);
the file sits under an app-made key, `firms/{firmId}/entities/{entityId}/{documentId}`.

Uploads go through the app as a remote form (up to 25 MB), so the server checks the
type against an allowlist and the file's signature before storing it. Downloads are
streamed by the app after an access check and always sent as attachments. Removal is
soft and audited. Local MinIO uses Chainguard's image, as MinIO no longer publishes
community images.

## Why

Object storage keeps large files out of PostgreSQL and backups manageable; R2 has no
egress fees and an S3 API, so local and production code are the same. Uploading
through the app is the simplest secure design for files this size: one request, works
without JavaScript, and nothing reaches storage unchecked.

## Consequences

`BODY_SIZE_LIMIT` rises to 26M. Large evidence files (scans, data exports) may later
need direct-to-storage uploads with short-lived signed URLs and a confirm step. Malware
scanning and a retention schedule are required before real client files.
