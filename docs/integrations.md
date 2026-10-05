# Integrations

## Principle

Lines owns a canonical internal financial model.

External integrations transform external data into that model.

Vendor-specific concepts must not leak throughout the domain.

## V1

### CSV / Excel-style imports

Highest priority.

Support realistic accounting exports for:

- trial balance
- general ledger
- journals
- aged receivables
- aged payables

The import layer must tolerate imperfect real-world files.

### Companies House

`src/server/integrations/companies-house.ts` looks up companies by number and searches
by name, and maps responses into our own `CompanyProfile` (name, type, status,
incorporation date, registered office, SIC codes, year end, accounts dates). Entities
store those fields in their own columns. It also lists officers and people with
significant control (PSCs), mapped into `CompanyOfficer` and `SignificantControl`
(name, role, dates, month and year of birth, officer ID, our own control kinds).

- Importing an entity's officers and PSCs matches each one to a person the firm
  already has: by Companies House officer ID, otherwise by kind, name and month and
  year of birth. Re-importing is safe: it adds new roles and updates end dates and
  controls on imported roles, and never touches roles entered by hand. Officer roles
  we don't record (for example judicial factors) and protected PSCs are skipped. Only
  the first 100 officers and PSCs are read, plenty for V1 clients.
- Shareholders are not on the API (they are in confirmation statement documents), so
  they are entered by hand.

- Optional: set `COMPANIES_HOUSE_API_KEY` (a key from a **Live** application in the
  Companies House developer hub; Test keys only work on the sandbox). Without it,
  entities are entered by hand.
- Owners and admins only; 100 lookups per user per 5 minutes (Companies House allows
  600 per 5 minutes per key). 5-second timeout; any failure says so and allows manual
  entry. Responses are validated before use.
- Companies House is a source, not the authority: the firm can edit details, and
  framework and size are always the firm's judgement.
- Tests inject a fake client and never call the real API.

### Xero

Early accounting-system integration.

Potential data:

- chart of accounts
- trial balance
- transactions
- journals
- invoices
- contacts

Map all retrieved data into Lines' canonical financial model.

## Infrastructure integrations

### Object storage

Evidence/files should live in S3-compatible object storage rather than in the
database.

Database stores metadata and references.

### Email

Needed for:

- user invitations
- notifications
- authentication
- eventually client evidence requests

### Password breach screening

Public deployments check new passwords against the Have I Been Pwned range API
(`identity/passwords.ts`), sending only a five-character hash prefix. Development and
tests never call it. See `security.md`.

### AI provider

AI access should be behind an application-owned abstraction.

Business/domain logic must not depend directly on a particular model vendor.

Persist enough metadata for consequential AI-assisted work to be auditable.

## Later

Possible future integrations include:

- QuickBooks
- Sage
- FreeAgent
- Microsoft Dynamics
- NetSuite
- bank-data providers
- audit confirmation platforms
- identity providers

Do not implement these until customer evidence justifies them.
