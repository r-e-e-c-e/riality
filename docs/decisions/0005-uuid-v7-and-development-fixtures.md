# 0005 — UUID v7 and deterministic development fixtures

Require PostgreSQL 18+ and use ``uuid().default(sql`uuidv7()`)`` for generated
UUID identifiers. Use `Bun.randomUUIDv7()` when the application needs an ID before
insertion, such as encrypted outbox records whose ID is authenticated data.
References have no generated default. Preserve existing UUIDs during upgrades;
rewriting identifiers would break references, audit attribution and encryption.
Token/recovery hashes remain cryptographically random credentials, not UUIDs.

Use typed Drizzle inserts for the small development fixture set. Drizzle's seeding
library offers deterministic generated data, but its UUID generator emits v4 and
its PostgreSQL reset uses TRUNCATE CASCADE. Explicit preset v7 IDs, tenant ownership
and audit attribution are clearer here without an additional dependency. Revisit
`drizzle-seed` only if larger generated datasets justify it; do not replace the
guarded migration-based reset with its truncation helper.

Fixtures use literal IDs and fixed timestamps, with fresh Argon2 salts. They are
inserted together under the tenancy lock, using the real constraints/triggers.
Reruns preserve later edits and permission removals. Conflicting identities or
missing core fixture/audit records are refused rather than overwritten. Seeding
requires a local development/test database, loopback application origin and preview
mail. The fixture password is public synthetic data and must never reach production.

References: [Drizzle seed overview](https://orm.drizzle.team/docs/seed-overview),
[seed generators](https://orm.drizzle.team/docs/seed-functions),
[PostgreSQL 18 UUID functions](https://www.postgresql.org/docs/18/functions-uuid.html),
[Bun UUID v7](https://bun.sh/docs/runtime/utils#bun-randomuuidv7).
