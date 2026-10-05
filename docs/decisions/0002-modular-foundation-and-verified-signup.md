# 0002 — Modular foundation and verified signup

Status: accepted

## Decision

Use `src/server/modules/{identity,tenancy,audit,notifications}` with module-owned
`*.entity.ts`, `*.service.ts` and shared operation schemas in `src/lib/schemas`.
Use Zod 4 via Standard Schema at remote boundaries. Services own authorization,
invariants and transactions; no generic repositories/event bus are introduced.

Retain custom Bun authentication for the MVP. Public signup verifies the mailbox
before choosing a password. Joining existing firms requires an explicit invitation.
Add one-use recovery, immediate subsequent-request session revocation and TOTP MFA,
mandatory on public deployments. Keep all credentials behind the identity module.

Use Resend's HTTP API for transactional email, with an encrypted PostgreSQL outbox
and a bounded scheduled Bun worker. A delivery provider is necessary for verification,
recovery and invitations; no new SDK, queue service or auth library is required.
Local previews are private ignored files and forbidden for public origins.

## Reason and consequences

The founder explicitly chose custom auth while SvelteKit 3 integrations settle.
The application owns ongoing authentication/security maintenance and must obtain
independent review before real-client use. Module boundaries keep that work contained.

Firm ownership remains independent of access; parent groups never inherit permissions.
Existing IDs/memberships/audit records are preserved; the security upgrade revokes
old sessions and trusts only previously operator-provisioned accounts as verified.

Privacy notices, supplier contracts, retention, rights handling and production
controls remain evidenced operational responsibilities. See security/privacy/operations
for current implementation and launch requirements. No compliance certification is claimed.
