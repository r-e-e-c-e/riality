# Architecture and coding guide

Read this before writing code. Product scope is in `product.md`, the audit domain in
`domain.md`, security controls in `security.md`.

## Stack

A TypeScript modular monolith: SvelteKit 3 (Svelte 5 runes, remote functions), Bun,
PostgreSQL 18, Drizzle ORM (pinned `1.0.0-rc.4`, ORM and Kit together), postgres.js
and Zod 4. The official Bun adapter builds the server. Authentication is our own code
on Bun/Web Crypto; there is no auth library. PostgreSQL also does rate limiting, the
email outbox and locks, so there is no Redis or queue service.

Do not add a framework, service or infrastructure dependency without a written reason.

## Layout

```text
src/
  env.ts                      every environment variable, with Zod schemas
  hooks.server.ts             session lookup, request ID, security headers, starts jobs
  lib/
    schemas/                  Zod schemas for operation inputs (shared by browser and server)
    remotes/                  remote functions used by several routes
    components/               shared Svelte components
  routes/                     route groups (in brackets) organise pages without changing URLs
    (auth)/                   signed-out pages (Lines branding): login, signup, password reset, invite
    (staff-portal)/           signed-in staff; the layout renders the app header
      +page.server.ts         lines.ws/ redirects to the last-used firm (the only server load)
      account/ welcome/ new-firm/
      [handle=handle]/        a firm workspace: dashboard, clients, engagements, settings
        <page>/+page.svelte
        <page>/<name>.remote.ts  remote functions used only by this page
  params.ts                   route matchers ([handle=handle] only matches handle-shaped paths)
  server/                     server-only (SvelteKit blocks browser imports)
    app.ts                    the running app's config, db and services
    config.ts                 createConfig(env): turns env into Config, refuses unsafe settings
    services.ts               createServices(db, config): builds every service
    request.ts                helpers for remote functions (requireUser, cookies, errors)
    request-context.ts        per-request IDs (AsyncLocalStorage) for logs and audit events
    integrations/             outside APIs (Companies House), mapped into our own types
    logger.ts                 JSON log lines
    jobs.ts                   in-process background jobs (email delivery, cleanup)
    db/                       connection, column helpers, runtime grants, dev seed/reset
    modules/
      identity/               users, sessions, passwords, MFA, rate limits, operator actions
      tenancy/                groups/firms tree, memberships, invitations, access checks
      clients/                clients and legal entities (Companies House details)
      engagements/            reporting periods, engagements, teams
      audit/                  append-only audit events
      notifications/          encrypted email outbox and senders
scripts/                      operator and dev commands (use the real services)
tests/integration/            service tests against a real PostgreSQL database
tests/*.e2e.ts                Playwright browser tests against the built app
drizzle/                      migrations (generated + hand-written security guards)
```

Imports: code inside `src/server` imports other server files relatively, with no
suffix. Routes, remote functions and hooks import server code with `#server/*.js`,
and anything imports shared code with `#lib/*.js` (package.json subpath imports).

File names inside a module: `*.entity.ts` (Drizzle tables), `*.service.ts`
(operations), `*-access.ts` (permission checks). Keep modules small. No repositories,
controllers, event bus or DI container.

## How a request flows

```text
+page.svelte
  -> *.remote.ts        validates input with Zod, gets the actor from the session
  -> service method     checks access, enforces rules, runs the transaction, records audit events
  -> Drizzle tables     constraints and foreign keys back up the rules
```

`hooks.server.ts` looks up the session cookie on every request, sets `locals.user` /
`locals.session`, gives the request an ID (`x-request-id` header), and runs the rest of
the request inside a request context so logs and audit events carry that ID.

## Patterns

**Services** are plain factory functions, `createXService(db, config)`. They never
import SvelteKit, so tests and scripts can use them directly. `createServices` wires
them up. The web app builds them once in `server/app.ts`; tests and scripts build
their own with their own database.

**Actors** come from the session (`requireUser()` and friends in `server/request.ts`),
never from form fields. A `userId` in a form is the subject of a change, not who made it.

**Remote functions** are thin: validate, get the actor, call one service method, then
refresh affected queries. Put them next to the page that uses them; only put them in
`lib/remotes/` when several routes share them. Use `query` for reads, `form` for user
submissions and `command` for programmatic writes. In forms, wrap the work in
`submit()` (including `requireRecentUser()`) so business errors show next to the
form. Queries need no wrapper (see Errors below).

Firm pages get the firm from the URL with `getWorkspace(page.params.handle)`
(`lib/remotes/workspace.remote.ts`), then pass `workspace.firm.id` to other queries.
Services take firm IDs, never handles, apart from the workspace lookup.

Use `form.for(key)` only for forms repeated on a page (one per list row). Known
SvelteKit limitation: after a no-JavaScript submit, keyed forms do not show their
errors. Forms that appear once per page use the plain form. Recheck after SvelteKit
upgrades.

- `requireIdentity()`: any signed-in user (account security pages)
- `requireUser()`: signed in and MFA done where required (everything else)
- `requireRecentSignIn()`: password entered in the last 10 minutes (account changes)
- `requireRecentUser()`: `requireUser()` plus a recent sign-in (team, membership and
  firm changes)

**Access checks** (`tenancy/tenancy-access.ts`, `engagements/engagement-access.ts`):
call one at the start of every service method, then filter every query by the checked
`firmId` (and `engagementId`). Never load a firm-owned record by its ID alone. Inside
a write transaction, pass `tx` to the check. Non-members get 404, so we never reveal
that something exists.

- `requireFirmMember` / `requireFirmAdmin` / `requireFirmOwner` (and `requireTenantRole`
  for groups), all in `tenancy-access.ts`
- `requireEngagementTeamMember`: engagement content always needs a team assignment,
  even for firm owners

Future audit-graph services (risks, procedures, evidence, ...) follow the same
pattern with `requireEngagementTeamMember`.

**Audit events**: every consequential change calls `recordEvent(tx, ...)` in the same
transaction. Actions and their typed `details` are listed in `AuditDetails` in
`audit/audit-event.entity.ts`. Add a line there for a new action; no migration needed.
Request and session IDs are added automatically. Never put secrets, raw emails or
financial content in details.

**Zod schemas** describe operations, not database rows. Never accept a table's insert
shape from the browser. Passwords are never trimmed. Sensitive form fields start with
`_` so SvelteKit never echoes them back.

**Locks**: `lockTenancyAdministration(tx)` (one global advisory lock) serialises
access changes only: the tenant tree, memberships, invitations and team assignments.
These are rare. Never use it for audit work. Use row locks or constraints there.

**Firm-owned tables** have `firmId` plus a unique `(firmId, id)`, and children
reference that pair, so the database refuses cross-firm links. There is no PostgreSQL
row-level security yet; isolation relies on the access checks, these foreign keys
and tests.

## Errors

- **Expected failures** (not found, no access, conflict, wrong password) are thrown
  as `BusinessError` with a code from the catalogue in `server/errors.ts`, for example
  `throw new BusinessError('LAST_OWNER')` or `throw notFound('Engagement')`. Throwing
  also rolls back the transaction. Add new codes to the catalogue; never invent a
  status and message inline. Mark wrong-credential codes `failedAttempt: true` so the
  rate limiter counts them.
- In forms, `submit(work, { CODE: 'fieldName' })` attaches a business error to a
  field, which marks its input invalid (for example
  `{ ENGAGEMENT_EXISTS: 'periodStart' }`, or `NEW_PASSWORD_FIELD` for password forms).
  Services stay unaware of form field names.
- **Outcomes the caller should handle** (import problems, completion blockers, which
  second factor matched) are returned as values, not thrown.
- `handleError` in `hooks.server.ts` turns business errors into a response with their
  status, message and `code`. It logs real bugs and returns a 500 with a `reference`
  (the request ID). Invalid remote-function input becomes a 400 and a warning.
- Pages show errors through `+error.svelte` at three levels: the root (signed out),
  `(staff-portal)` (keeps the header) and `[handle=handle]` (keeps firm navigation).
  `ErrorDetails.svelte` chooses the wording and next step from `page.error.code` and
  the status. SvelteKit 3 wraps each level in a `<svelte:boundary>`, so a failing
  query or rendering bug shows the nearest error page. For a part of a page that may
  fail on its own (for example an analytics panel), wrap it in `<svelte:boundary>`
  with a retry.
- 404 means "missing or not yours", so we never reveal that something exists.

## Configuration

`src/env.ts` defines every variable with a Zod schema. SvelteKit validates them at
startup; `scripts/lib/runtime.ts` validates `process.env` with the same schemas.
`server/config.ts` then builds a typed `Config` and refuses unsafe combinations (a
public origin without HTTPS, preview email or MFA). Code reads `config`, never
`process.env`.

## Persistence

- Entities live in `modules/**/*.entity.ts`; Drizzle Kit discovers them automatically.
- Use `snakeCase.table`, camelCase properties without column-name strings, and keep
  explicit names for constraints and indexes.
- IDs: `id()` from `db/columns.ts` (`uuidv7()` default). Use `Bun.randomUUIDv7()`
  only when the app needs the ID before inserting.
- Migrations: change entities, run `bun run db:generate`, review the SQL, commit it.
  Triggers and other hand-written SQL go in custom migrations
  (`drizzle-kit generate --custom`). Never use `db:push`: it skips the security
  triggers. Never edit a migration that has run anywhere real.
- Pre-launch, migrations were squashed into one baseline plus `security_guards`.
  Once real data exists, migrations are append-only.
- Services use `inTransaction(db, async (tx) => ...)` (`db/transaction.ts`), not
  `db.transaction`. It retries deadlocks and serialization failures up to three times,
  then returns a 503 "try again". The work may run more than once, so keep external
  side effects (sending email, HTTP calls) out of it; queue email with `mail.enqueue`.
- Add new tables to `db/permissions.ts` so the restricted runtime role can use them.

## Background jobs

`server/jobs.ts` runs inside the web process, started by the `init` hook: it sends
queued email every 5 seconds and removes expired records hourly. Running several app
servers is safe (`SKIP LOCKED`, idempotent deletes). Operator actions (provisioning,
disabling users, MFA reset, key rotation, runtime grants) are interactive scripts in
`scripts/`, never web endpoints.

## Logging

Use `logger` from `server/logger.ts`. It writes JSON lines with the request ID. Log
unexpected errors with `describeError(error)`, which drops messages that may contain
personal data. Never log passwords, tokens, codes, emails, request bodies or
financial data. The rate limiter logs failed and throttled sign-in attempts as
`security event` warnings, using fingerprints only.

## Testing

Test behaviour that matters, not lines of code. One tool per job:

| What                                           | Tool                                     |
| ---------------------------------------------- | ---------------------------------------- |
| Services, permissions, database rules, scripts | `bun test` (`tests/integration/`)        |
| Complex Svelte components                      | Vitest browser mode (`*.svelte.test.ts`) |
| Key user journeys through the built app        | Playwright (`tests/*.e2e.ts`)            |

- **Service tests** call services against a real disposable PostgreSQL database; do not
  mock the database. Focus on authorisation boundaries, invariants, concurrency and audit
  records. `isolatedDatabase()` gives a test its own fresh database when it needs one.
- **Component tests** run in real Chromium with the app's Vite/Svelte setup. Write them
  only for components with real logic (for example a mapping grid or risk matrix); simple
  forms and pages are covered by Playwright. No Storybook until there is a design system.
- **E2E tests** cover a few important journeys, including without JavaScript.

Use synthetic data only. Test database names must end in `_test`.

## Validation before finishing

`bun run format`, `bun run check`, `bun run lint`, the relevant tests and
`bun run build`. For Svelte changes also run the Svelte autofixer when it is available.
