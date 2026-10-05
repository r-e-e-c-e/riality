# 0007 — Typed audit events, failure-only rate limits, in-process jobs

Status: accepted. Replaces the parts of 0003, 0004 and 0006 noted below.

## Decisions

**Audit events.** `audit_event` has a few indexed columns (action, actor or operator,
tenant, engagement, subject user, target type/id, session ID, request ID) plus a
`details` JSONB column. Each action's details are typed in `AuditDetails`
(`audit-event.entity.ts`). `action` is text, not a PostgreSQL enum. Adding an action is
a one-line type change with no migration. This is a deliberate exception to "prefer
explicit columns over JSON": a log needs a flexible payload, and the TypeScript type
keeps it explicit. The previous design added a column per kind of reference, which
would have grown with every audit-graph object.

**Rate limits.** Stop bots without ever blocking real staff, who often share one
office IP. Sign-in and code checks count failures only. The per-account sign-in limit
is keyed by email + address, so a bot elsewhere cannot lock a user out. Only the
second factor is limited per user across addresses. Argon2 work queues instead of
rejecting bursts.

**Background jobs.** Email delivery and cleanup run inside the app process (started by
the SvelteKit `init` hook) instead of cron scripts. That is one deployable with no
scheduler, and emails send within seconds. The outbox's `SKIP LOCKED` keeps several
servers safe.

**Locks.** The global tenancy advisory lock now covers only access changes (tree,
memberships, invitations, team assignments). Client, entity and engagement creation
and reads no longer take it, and the client trigger uses a row lock on the firm.
(Replaces the setup-lock part of 0006.)

**Access checks.** One check at the start of each service method, then queries
filtered by the checked firm/engagement IDs, with composite foreign keys as backup.
The repeated in-query EXISTS predicates were removed. (Simplifies 0006.)

**Migrations squashed.** Before any real data existed, history was squashed to one
generated baseline plus a hand-written `security_guards` migration, and the v0→v1
upgrade test was deleted. (Replaces the upgrade-verification parts of 0003 and 0004.)
From the first real deployment, migrations are append-only.

**Config and scripts.** Scripts validate `process.env` with the same schemas as
SvelteKit (`src/env.ts`), build `Config` with `createConfig`, and call the real
services through `createServices`. Services stay plain factories that take
`(db, config)`, so tests and scripts can build their own.

**Observability.** Each request gets a UUID v7 request ID (an `x-request-id` header,
JSON logs, error references and audit events) through `AsyncLocalStorage`. Logging is
a small JSON writer with no vendor SDK. Add error tracking when there is a production
environment.

**Errors.** Expected failures are coded `BusinessError`s from one catalogue
(`server/errors.ts`). They are thrown, not returned, because throwing rolls back
Drizzle transactions. Results are returned only for outcomes callers handle as normal
flow. SvelteKit 3's `handleError` (with `kind`) maps errors to responses in one place,
which removed the per-query `expose()` wrapper. Nested `+error.svelte` pages keep the
surrounding layout. Security events are logged by the rate limiter, which removed the
per-method security wrapper. Login accepts a same-site `next` path so sign-in returns
the user to where they were.

Services run transactions through `inTransaction`, which retries PostgreSQL
deadlocks and serialization failures, because the app uses row and advisory locks.
Forms map business error codes to their own field names, so domain code never knows
about HTML forms.

## Consequences

Old audit rows from development databases are discarded by `db:reset`. Operator
actions are attributed by operator name, with a reason in `details`. An operator MFA
reset (`auth:reset-mfa`) now exists for lost authenticators.
