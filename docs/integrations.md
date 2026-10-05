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

Use for UK entity metadata where useful.

Possible data:

- company number
- legal name
- registered status
- incorporation data
- officers
- filing metadata

Lines should not treat Companies House as the authoritative source for all
engagement data.

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
