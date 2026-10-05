# Client, entity and people model

## Goal

Model everything around an engagement well enough to support about 98% of UK audit
firms before building the audit workflow itself. There are three separate concepts:

- **Client**: the commercial relationship the firm manages (for example "Harrow family").
- **Entity**: a legal or reporting body that is audited, with a year end and filings.
- **Person**: a real human linked to entities by role (director, shareholder, contact).

## To do

1. [x] **Entity details and Companies House**: type, company number, status,
       incorporation date, registered office, SIC codes, year end, accounts due date,
       accounting framework and size. Add an entity by Companies House number or
       search, and refresh it later. Entity detail page. Move client and entity code
       into a `clients` module.
2. [ ] **People and roles**: firm-scoped people; roles on entities (director,
       secretary, shareholder %, PSC, signatory, contact) with dates; officers and
       PSCs imported from Companies House.
3. [ ] **Entity relationships**: ownership graph (parent → child, %, kind), allowed
       across clients; group-structure view on the client page. Feeds related parties,
       independence checks, exemptions and later group audits.
4. [ ] **Client and staff roles**: client partner and manager; staff professional
       profile (qualification, Responsible Individual status for audit sign-off).
5. [ ] **Files**: storage choice (S3-compatible), upload security review, permanent
       file per entity. Scope: client, entity or engagement.
6. [ ] **Threads, requests and tasks**, then the client portal (people as external
       users, scoped to their own entities and requests).

Later, with the audit workflow: suggest the engagement period from the entity's year
end, roll forward from the prior year, a group-audit engagement type with components.

Out of scope (V1 non-goals): billing, time and WIP, CRM pipeline, tax, scheduling.

## Step 1 decisions

- Companies House is an integration (`src/server/integrations/companies-house.ts`)
  that maps API responses into our own `CompanyProfile`; vendor field names never
  reach the database or services. Lookups are optional: without
  `COMPANIES_HOUSE_API_KEY`, entities are entered by hand.
- Lookups are for firm owners and admins, rate limited per user, with a short
  timeout. Tests inject a fake client; they never call the real API.
- Companies House fields (name, type, status, dates, address, SIC codes, year end,
  accounts due) can be refreshed; framework and size are the firm's judgement and
  are edited by hand. Every change is an audited `entity.updated` with field names.
