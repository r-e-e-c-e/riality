# 0003 — Drizzle v1 and table-level casing

## Decision

Use matching, exact `drizzle-orm` and `drizzle-kit` versions, currently
`1.0.0-rc.4`. This is the published v1 release candidate rather than stable v0.
Use `snakeCase.table` for module entities, camelCase property keys and unnamed
column builders. Keep existing SQL names for tables, enums, indexes and checks.
Connection construction uses `drizzle({ client })`; explicit query builders do
not need relational definitions.

## Consequences

Naming is encoded once at the entity boundary and applies to runtime SQL and
migration generation. Existing SQL column names and tenancy/auth behavior remain
unchanged. Kit's schema filter remains `public`, preserving the v0 scope.

Migrations use v1's timestamped folders (`drizzle/<timestamp>_<name>/`). See 0007 for
the pre-launch squash.

Exact pins make release-candidate changes deliberate and reviewable. Upgrade ORM
and Kit together and repeat schema drift, existing-data and security tests.

References: [v1 upgrade](https://orm.drizzle.team/docs/upgrade-v1),
[v1 changes](https://orm.drizzle.team/docs/v0-v1-changes),
[table casing](https://orm.drizzle.team/docs/sql-schema-declaration#camel-and-snake-casing).
