# Lines

Lines is a cloud audit platform for UK accounting firms. V1 is narrowly focused on
straightforward UK SME statutory audits. Long term it may grow into wider financial
work, but do not build future products into the current app.

Stack: TypeScript, SvelteKit 3 (Svelte 5 runes, remote functions), Bun, PostgreSQL 18,
Drizzle, Zod 4. Package manager: bun.

## Product principles

- An audit is structured data, not a pile of documents. Workpapers are views over that data.
- The core audit graph: financial statement area → assertion → risk → procedure →
  evidence → finding → conclusion → review/sign-off.
- Every consequential action must be attributable and audited.
- Human auditors own professional judgement. AI may suggest, summarise and draft; it
  never silently makes audit decisions.
- Prefer explicit domain objects over generic JSON (audit event details are the
  documented exception).
- Prefer simple code over speculative abstraction. Build only what V1 needs now.

## Who V1 is for

Independent UK audit/accounting firms of roughly 10–100 staff with meaningful
statutory audit volume, currently on Caseware, IRIS or similar, where partners make
the buying decision and are unhappy with legacy workflow and usability.

Not for V1: PIE or listed audits, complex groups, pensions, public sector,
specialist charities, multinational networks.

## Domain hierarchy

Organisation group (optional, nestable) → Firm → Client → Entity → Engagement →
Reporting period. Users have direct memberships; owning a group never grants access
to its firms.

## Read before changing

| Area                                                                                  | Doc                               |
| ------------------------------------------------------------------------------------- | --------------------------------- |
| Scope, ICP, non-goals                                                                 | `docs/product.md`                 |
| Audit semantics, risks/procedures, methodology, engagement state                      | `docs/domain.md`                  |
| Engagement stages and UX flow                                                         | `docs/workflows.md`, `docs/ui.md` |
| Code layout, patterns, services, access checks, persistence, testing                  | `docs/architecture.md`            |
| Auth, authorisation, tenant isolation, uploads, AI calls, audit logs, retention       | `docs/security.md`                |
| External APIs and accounting data (map into our model; never adopt a vendor's schema) | `docs/integrations.md`            |
| AI features                                                                           | `docs/ai-product-stance.md`       |
| Deployment, operator commands, monitoring                                             | `docs/operations.md`              |
| Personal data and retention                                                           | `docs/privacy.md`                 |

Durable decisions: `docs/decisions/`. Plans for large changes: `docs/plans/active/`.

## Code in brief

- Services in `src/server/modules/<module>/*.service.ts` are plain factories taking
  `(db, config)`; they never import SvelteKit. Remote functions are thin: validate
  with Zod, get the actor from the session, call one service method.
- Put remote functions next to their page (`routes/(group)/<page>/<name>.remote.ts`);
  use `src/lib/remotes/` only when several routes share them.
- Every service method checks access first (`tenancy-access.ts`,
  `engagement-access.ts`), then filters queries by the checked firm/engagement.
- Every consequential change calls `recordEvent(tx, ...)` in the same transaction.
- Expected failures throw a coded `BusinessError` from `src/server/errors.ts`; add
  new codes there. `hooks.server.ts` turns them into responses.
- Write for a junior–intermediate engineer: plain English names and comments, short
  functions, obvious control flow.

## Security

This app will hold highly sensitive financial data. Never commit secrets or real
client data; use synthetic data in development and tests.

## Workflow

Before implementing: read the relevant code and only the docs relevant to the task;
keep existing patterns unless there is a good reason to change them.

After changes: `bun run format`, `bun run check`, `bun run lint`, the relevant tests
(`test:integration`, `test:components`, `test:e2e`) and `bun run build`. Review the diff. Do
not claim a task is complete while validation fails.

When a domain or architecture decision changes, update the matching doc in the same
change. Docs describe current truth, not history.

## Svelte MCP

When available, use the Svelte MCP tools: `list-sections` and then `get-documentation`
for Svelte/SvelteKit questions, and `svelte-autofixer` on Svelte code you write (repeat
until it reports no issues). Offer a `playground-link` only for code not written to
project files.
