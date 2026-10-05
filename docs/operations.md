# Operations

How to run Lines locally and in production. These steps must be done, with evidence
kept, before a real-client pilot.

## Local development

See the README for the commands. Notes:

- The Docker database listens on `127.0.0.1:6000` (database `local`).
- Emails are written to `.local/mail/` by the app's background job (`MAIL_MODE=preview`).
  They contain working sign-in links, so never share them.
- `bun run db:reset` drops the schema and re-applies every migration. `--seed` adds
  fixtures; `--check` only shows the target. It refuses anything that is not a local
  database named `local` or ending in `_dev`/`_test`, a public `APP_ORIGIN`, or
  `NODE_ENV=production`.
- Fixtures (`src/server/db/seed-data.ts`) have fixed UUID v7 IDs:

| Sign-in                         | Firms (role)                                                    | Engagement teams                                                      |
| ------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| `group.owner@example.test`      | Baldwyn & Co (owner), Wilkins Kenmore (admin); owns both groups | Partner on 5 Baldwyn & Co audits; manager on 2 at Wilkins Kenmore     |
| `firm.owner@example.test`       | Wilkins Kenmore and Hartley Croft (owner), Baldwyn & Co (admin) | Partner at Wilkins Kenmore and Hartley Croft; manager at Baldwyn & Co |
| `auditor@example.test`          | Baldwyn & Co (member)                                           | Auditor on 4 Baldwyn & Co audits                                      |
| `standalone.owner@example.test` | Meadowcroft Audit (owner)                                       | Partner on Meadowcroft Audit's 3 audits                               |

The password is in `seed-data.ts`. The fixtures mimic a real PE roll-up with
fictional names (don't use them in demos for prospects):

- Azelle Group → Azelle North → Baldwyn & Co and Hartley Croft; Wilkins Kenmore sits
  directly under Azelle Group; Meadowcroft Audit is independent.
- The group owner can't see Hartley Croft: owning a group grants nothing inside it.
- At Wilkins Kenmore the group owner is an admin but not on Calder Dental's team, so
  it appears in the engagement list but can't be opened.

Never copy a seeded database anywhere real.

## Production environment

Set `DATABASE_URL`, `AUTH_ENCRYPTION_KEY`, `APP_ORIGIN` (HTTPS, the same at build and
runtime), `MAIL_MODE=resend`, `RESEND_API_KEY` and `MAIL_FROM`. MFA is always required
on a public origin. The app refuses to start with unsafe settings.

- Run Bun behind a TLS reverse proxy; block direct access to the app and database.
- If the proxy passes the client IP in a header, set the Bun adapter's
  `ADDRESS_HEADER` (and `XFF_DEPTH` for `X-Forwarded-For`). The proxy must overwrite
  client-supplied values. Get this right, or rate limits treat every user as one address.
- Set `BODY_SIZE_LIMIT=64K`. Keep server clocks synchronised (TOTP depends on it).
- Remote PostgreSQL always uses verified TLS. For a private CA, add it to the
  runtime's trust store; never disable verification.
- Keep `AUTH_ENCRYPTION_KEY` in a secret manager, backed up separately from database
  backups. Losing it locks every MFA user out.

## Database roles and migrations

1. Run migrations (`bun run db:migrate`) with a migration role that owns the schema.
2. Create a separate runtime login: `NOINHERIT`, no superuser, CREATEDB, CREATEROLE,
   memberships or ownership.
3. Run `bun run db:grant-runtime <role>` with the migration connection. It refuses
   privileged roles and grants exactly the tables in `src/server/db/permissions.ts`:
   read/write on app tables, SELECT/INSERT only on `audit_event`. Run it again after
   adding tables.
4. Start the app with the runtime login.

Never use `db:push`: it skips the security triggers.

## Background jobs and monitoring

Email delivery (every 5 s) and expired-record cleanup (hourly) run inside the app
(`src/server/jobs.ts`). There is no cron to configure, and running several servers is
safe.

Logs are JSON lines on stdout/stderr, each with a `requestId` that also appears in
the `x-request-id` header, error references and audit events. Send them to a
restricted log service with a set retention period, and alert on:

- `unhandled server error`, `background job failed`, `mail delivery failed`
- bursts of `security event` (failed or throttled sign-ins, `password.check_unavailable`)
- a growing `mail_outbox`

In Resend, configure SPF/DKIM/DMARC and turn off click/open tracking. Public password
changes need outbound HTTPS to `api.pwnedpasswords.com`.

## Backups and recovery

Configure automated encrypted backups and decide their retention (see `privacy.md`).
Test a restore before the pilot and after major storage changes, in an isolated
environment with email off. After restoring, revoke sessions, reset links and
invitations; restored recovery codes may need replacing.

## Operator commands

All are interactive (they need a terminal) and record the operator's OS username in
the audit history. Run them from the hosting platform's audited console, not from a
laptop holding production credentials.

| Command                        | Use                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run auth:provision`       | Create a verified account (bootstrap/support). Verify the email independently first.                                                                 |
| `bun run auth:disable`         | Disable an account. `offboarding` refuses if they are a tenant's only owner; `security_incident` always proceeds and lists tenants needing an owner. |
| `bun run auth:reset-mfa`       | Remove MFA after a lost authenticator and recovery codes. Only after verifying identity through a separate trusted channel.                          |
| `bun run auth:rotate-key`      | Re-encrypt MFA secrets and queued email with a new key (see below).                                                                                  |
| `bun run db:grant-runtime`     | Grant the runtime role its table privileges.                                                                                                         |
| `bun run tenancy:create-group` | Create an ownership group owned by an existing user.                                                                                                 |
| `bun run tenancy:move`         | Move a firm (by handle) into a group or back to the top level, after both owners agree.                                                              |

### Key rotation

1. Stop the app on every server.
2. Back up the database and the old key.
3. Generate a new key (`bun run auth:key`).
4. Run `AUTH_MAINTENANCE=true AUTH_ENCRYPTION_KEY_NEXT=<new> bun run auth:rotate-key`.
   It re-encrypts everything in one transaction; any failure rolls it all back.
5. Set `AUTH_ENCRYPTION_KEY` to the new key everywhere and start the app.
6. Keep the old key safe for as long as old backups are kept.

If the key may have leaked, also revoke sessions, reset links, invitations and
recovery codes as the incident requires.

### Account incidents

Confirm identity through an agreed independent channel, never by email alone. Hand
over sole ownership before routine offboarding. For a confirmed compromise, use
`auth:disable` with `security_incident`, then fix ownership of the listed tenants.
There is no browser-based superuser.

## CI

`.github/workflows/ci.yml` runs on every push: lint, type-check, migration drift
check, unit, integration and e2e tests (also with MFA required), build and
`bun audit`. It uses synthetic data and keys only. Dependabot opens grouped dependency
updates monthly. For SOC 2 change-management evidence, protect `main` in GitHub
settings so changes arrive by pull request with passing CI.
