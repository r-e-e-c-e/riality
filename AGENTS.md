## Project Configuration

- **Language**: TypeScript
- **Package Manager**: bun
- **Add-ons**: experimental, prettier, eslint, vitest, playwright, sveltekit-adapter, drizzle, ai-tools, enhanced-img

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.

# Lines

Lines is a modern cloud audit platform for accounting firms.

The initial product is focused narrowly on straightforward UK SME statutory
audits. The long-term ambition is broader financial work infrastructure, but
do not build speculative future products into the current application.

## Product principles

- Audit is modelled as structured state, not a hierarchy of documents.
- The core audit graph is:
  Financial statement area
  -> assertion
  -> risk
  -> procedure
  -> evidence
  -> finding
  -> conclusion
  -> review/sign-off.
- Workpapers are views over structured audit data; they are not the primary
  domain model.
- Every consequential audit action must be attributable and auditable.
- Human auditors remain responsible for professional judgement.
- AI may suggest, summarise and draft; it must not silently make audit decisions.
- Prefer explicit domain objects over generic JSON blobs.
- Prefer simple implementations over speculative abstraction.
- Build only for current V1 requirements unless explicitly asked otherwise.

## V1 ICP

Independent UK accounting/audit firms performing straightforward private
company SME audits.

Initial target firms:
- roughly 10-100 audit/accounting staff
- meaningful annual statutory audit volume
- currently using products such as Caseware, IRIS or similar
- partner-led buying process
- dissatisfied with legacy workflow, usability or efficiency

Do not optimise V1 for:
- PIE audits
- listed companies
- complex group audits
- pensions
- public sector
- specialist charity audits
- multinational audit networks

See `docs/product.md` for the product definition and scope.

## Domain

The primary hierarchy is:

OrganisationGroup (optional)
-> Firm
-> Office/Team
-> Client
-> Entity
-> Engagement
-> Period

The core engagement model is documented in `docs/domain.md`.

For changes affecting audit semantics, risk/procedure relationships,
methodology or engagement state, read `docs/domain.md` first.

For engagement UX or stage progression, read `docs/workflows.md`.

## Architecture

Read `docs/architecture.md` before changing:
- service boundaries
- tenancy
- persistence architecture
- authentication/authorisation
- file storage
- audit/event logging

Do not introduce a new major framework, service or infrastructure dependency
without an explicit reason.

## Integrations

Read `docs/integrations.md` when working with external APIs or accounting data.

External systems must map into Lines' canonical domain model.
Never allow an external vendor's schema to become Lines' internal schema.

## Security

This product will process highly sensitive financial and audit data.

Read `docs/security.md` before changing:
- authentication
- authorisation
- tenant isolation
- uploads/downloads
- external AI calls
- audit logs
- retention/deletion

Never commit secrets or real client data.

Use synthetic data for development and tests.

## Engineering workflow

Before implementing:
1. Inspect the relevant existing code.
2. Read only the docs relevant to the task.
3. Preserve existing patterns unless there is a good reason to change them.

For substantial features or architectural changes, create/update a plan under
`docs/plans/active/`.

After changes:
- run formatting
- run type checking
- run relevant tests
- run the application/build where appropriate
- review the diff for accidental changes

Do not claim a task is complete if validation is failing.

## Documentation

When a domain or architectural decision materially changes, update the
corresponding documentation in the same change.

Important durable decisions should get a short ADR in `docs/decisions/`.

Documentation describes current truth, not historical discussion.