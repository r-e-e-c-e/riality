# 0004 — Password screening and operator lifecycle controls

Use native fetch for public-origin HIBP Pwned Passwords checks, before hashing or
consuming credentials on password creation/change. Send only a five-character hash
prefix and request padded responses; provider failure blocks new passwords,
preserving login and pending credentials.
Development uses an explicit small offline baseline; tests inject deterministic
responses. No auth library or additional infrastructure dependency is introduced.

Keep sanitized operational security events separate from transactional domain audit
history. Emit typed metadata and keyed fingerprints rather than request contents.
Logging retention and alert routing remain deployment responsibilities.

Offboarding, incident containment and encryption-key rotation use audited operator
services/interactive commands. Routine disablement preserves an active owner;
incident containment may require documented ownership remediation. Recovery-code
regeneration verifies both factors and the live session in one transaction, replacing
old codes and revoking every session. Key rotation requires drained processes and
atomic replacement of all encrypted MFA/outbox records before switching keys.

Test restricted SQL privileges independently of schema-owner fixture setup. Use
the shared grant manifest when provisioning the runtime role. Development reset removes the local schema and ledger and reapplies history.
Pin local/CI PostgreSQL to 18, matching the existing development volume.
