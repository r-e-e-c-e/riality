# 0001 — Hierarchical tenancy and Bun authentication

Status: accepted

## Decision

Use a PostgreSQL tenant adjacency tree with group/firm node kinds and stable IDs.
Groups may nest; firms remain the ownership boundary for future audit work.
Direct memberships govern authorization independently of the tree. Transfers
require ownership of the node and affected parents, serialize administrative
writes with a transaction advisory lock, and preserve memberships and history.

Use Bun's built-in Argon2id and random opaque database sessions without an auth
library. Use the official SvelteKit Bun adapter, remote functions for application
reads/mutations, request hooks for session identity, and injected domain services
for authorization/transactions. Public email-verified signup and explicit invitations are specified in ADR 0002.

## Reason

A standalone accounting firm must be able to join a private-equity roll-up without
rekeying or migrating audit history. Shared ownership must not silently expose
confidential audit data to parent/sibling staff. The small modular monolith and
native Bun APIs satisfy the requested foundation without speculative services.

## Consequences

Acquisition operators need explicit ownership grants in the affected nodes.
The administrative lock favors correctness and simplicity over simultaneous
topology updates. Bun is a required runtime. Session revocation and login limits
work across app instances through PostgreSQL. Verified signup, invitations, recovery and MFA are implemented as specified in ADR 0002. Production initialization must run both
generated and custom migrations; schema push alone omits security guards.
