# Lines

Cloud audit software for straightforward UK SME statutory audits.

Start with [product](docs/product.md), [domain](docs/domain.md) and
[architecture](docs/architecture.md). Security controls are in
[security](docs/security.md); running it is covered in [operations](docs/operations.md).

## Local development

Needs Bun 1.4+ and Docker (for PostgreSQL 18 and MinIO file storage).

```sh
bun install
cp .env.example .env
bun run auth:key          # paste the output into AUTH_ENCRYPTION_KEY in .env
bun run db:reset --seed   # starts Docker (database + storage), applies migrations, adds test data
bun run dev
```

Sign in as `group.owner@example.test` (password in `src/server/db/seed-data.ts`); you
land on the Baldwyn & Co workspace at `/baldwyn-co`. Or sign up at `/signup`. Emails
are written to `.local/mail/`, not sent. Synthetic permanent-file documents are uploaded
to the local MinIO (console at http://localhost:9001, `lines` / `lines-local-secret`).

| Command                     | What it does                                    |
| --------------------------- | ----------------------------------------------- |
| `bun run db:generate`       | Create a migration after changing `*.entity.ts` |
| `bun run db:migrate`        | Apply migrations                                |
| `bun run db:reset [--seed]` | Wipe the local database and re-apply migrations |
| `bun run db:seed`           | Add the synthetic test accounts and firms       |
| `bun run db:studio`         | Browse the database                             |

## Checks

```sh
bun run format && bun run check && bun run lint
bun run test:components --run   # Svelte component tests (browser)
bun run test:integration   # needs TEST_DATABASE_URL (see .env.example)
bun run test:e2e           # first time: bun x playwright install chromium
bun run build
```

For integration and e2e tests, create a disposable database whose name ends in `_test`
(for example `lines_test` in the Docker database) and set `TEST_DATABASE_URL`.

## Production

See [operations](docs/operations.md). In short: an HTTPS `APP_ORIGIN` at build and
runtime, Resend for email, a secret-managed encryption key, separate migration and
runtime database roles, and a TLS proxy. MFA is mandatory.
