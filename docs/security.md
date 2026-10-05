# Security controls

What the code does today. It is not a certification claim. Operational duties
(hosting, backups, monitoring) are in `operations.md`, data protection in `privacy.md`.
Do not load real client data until the pre-pilot checklist in `privacy.md` is done.

Read this before changing authentication, authorisation, tenant isolation, uploads,
external AI calls, audit logs or retention.

## Accounts and passwords

- Signup collects name and email only, then emails a one-use link. The password is
  chosen after the person proves they own the mailbox. Signup never reveals whether
  an email already has an account. `SIGNUP_MODE=invitation` limits signup to invited
  emails.
- Passwords: Argon2id (64 MiB, 2 passes), 15–128 characters, never trimmed, no
  composition rules. New passwords are checked against a small common-password list
  and, on public deployments, the Have I Been Pwned range API (only a 5-character
  SHA-1 prefix is sent). If that check is down, new passwords are refused (503);
  sign-in still works.
- Unknown emails are checked against a dummy hash, so timing does not reveal accounts.
- Argon2 work is limited to 4 hashes at once per server. Extra requests queue (200
  max) instead of failing, so a burst of staff signing in is never rejected.
- Emailed codes (signup, reset, invitation) are 32 random bytes; only SHA-256 hashes
  are stored. They expire after 60 minutes, 20 minutes and 7 days respectively. Links
  carry codes after `#`, so they never reach server logs or referrers. Opening a link
  never uses up the code; only submitting the form does.
- A password reset revokes every session and pending reset, and does not sign in or
  turn off MFA. Changing the password needs the current password and a recent sign-in.
- Email address changes and account deletion are not offered.

## Sessions

- Opaque 32-byte tokens; only SHA-256 hashes are stored. Signing in replaces the
  browser's previous session.
- Sessions end after 7 days, or 30 minutes without a request. Every request checks
  expiry, disabled/unverified accounts and MFA state in the database, so revocation
  applies from the next request.
- Cookie: `__Host-lines_session`, Secure, HttpOnly, SameSite=Lax, Path=/. Nothing is
  stored in localStorage.
- Sensitive actions (memberships, team changes, invitations, MFA setup, session
  management, account export) need the password within the last 10 minutes.
  Re-confirming rotates the token and keeps the original expiry.

## MFA

- TOTP (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step). Each code works once. Setup
  expires after 10 minutes and must be confirmed with a code.
- Ten recovery codes (132 bits each), stored as hashes, shown once, used up on use.
- Enabling MFA, replacing recovery codes and disabling MFA revoke every session.
  Disabling needs the password and a code, and is impossible where MFA is required.
- MFA is mandatory on public deployments: users without it can only reach Account
  security.
- A lost authenticator and lost recovery codes need an operator: verify identity
  through a separate trusted channel, then run `bun run auth:reset-mfa` (audited).
  A password reset email is never enough.
- MFA secrets and queued emails are encrypted with AES-256-GCM. Keys are derived from
  `AUTH_ENCRYPTION_KEY` with HKDF, and each value is bound to its record. A database
  copy alone cannot decrypt them.

## Rate limits

All limits are in `identity/rate-limit.service.ts`, stored in PostgreSQL and shared by
every server. Keys are HMAC fingerprints, never raw emails or IPs.

The rule is to stop bots without ever blocking real staff. A firm often shares one
office IP, so:

- Sign-in counts **failures only**: 10 per email+address and 200 per address, per
  15 minutes. Successful sign-ins never count. A bot elsewhere cannot lock a user
  out, because the per-account limit includes the address.
- Wrong second-factor codes: 10 per user per 15 minutes across all addresses. Only
  someone who already has the password can trigger this.
- Wrong emailed codes: 50 failures per address per 15 minutes.
- Wrong current password or code while signed in: 10 per user per 15 minutes.
- Signup and reset emails: 3 per email and 100 per address per 15 minutes.
  Invitations: 100 per inviter per hour.
- Signup and reset responses take at least about 250 ms, to hide timing differences.
- Every sign-in failure shows one message: "Email, password or security code is
  incorrect".

Behind a proxy, configure the Bun adapter's `ADDRESS_HEADER`/`XFF_DEPTH`, or every
user will share one address (see `operations.md`).

## Authorisation and tenant isolation

- Identity comes from the session, never from form fields. Every remote function
  checks access independently of what the UI shows.
- Memberships are direct. Owning a group gives no access to the firms inside it.
- Roles: member, admin and owner (tenant administration only). Owners and admins
  manage clients, engagements, teams, members and invitations. Only owners can grant
  ownership, change or remove an owner, invite or revoke owner invitations, or change
  the firm's name and handle. Engagement content also needs a team assignment, even
  for owners and admins. Team roles (auditor, manager, partner) are not sign-off
  authority.
- Users create standalone firms only. Ownership groups and moving firms between them
  are operator commands (`tenancy:create-group`, `tenancy:move`), audited under the
  operator's name. Moving a firm never grants access.
- Firm URLs use handles. A handle that doesn't exist and one you can't open both
  return 404. A changed handle is not redirected.
- Services check access first, then filter every query by the checked firm. Composite
  foreign keys stop records linking across firms. Database triggers keep the tenant
  tree valid and keep clients on firms.
- Non-members get 404, so we never reveal that a tenant or engagement exists.
- A tenant always keeps an active owner. Accepting an invitation needs the invited,
  verified email, and the inviter must still be allowed to grant that role.
- There is no PostgreSQL row-level security yet. Reconsider it as defence in depth
  before storing financial content.

## Audit history

- Every consequential change writes an `audit_event` in the same transaction: who
  (user, or operator name for scripts), tenant, engagement, subject, target, typed
  details, and the request/session ID.
- Events contain no passwords, tokens, codes, raw emails or financial content.
  Invitation events store a keyed fingerprint of the email.
- Append-only: a trigger blocks update and delete, and the runtime database role has
  only SELECT/INSERT on the table. Database superusers can bypass this, so restrict
  and log privileged access.
- Security failures (sign-in, MFA, throttling) go to the logs as separate
  fingerprinted events, not to audit history.

## HTTP and browser

- SvelteKit same-origin checks (CSRF) are on, with no extra trusted origins.
  `APP_ORIGIN` must be set at build and runtime.
- CSP with nonces: scripts and connections only from our origin; no framing, objects
  or `<base>`. Inline styles are allowed; inline scripts are not.
- Every response: `cache-control: private, no-store`, nosniff, frame denial, a
  restricted permissions policy, `referrer-policy: same-origin`, and HSTS on HTTPS.
- Unexpected errors return a generic message and a reference (the request ID); details
  stay in the logs. Business errors return only their catalogue message.
- After sign-in, `next` is followed only if it is a path on this site (no open redirects).
- Set `BODY_SIZE_LIMIT=64K` in production.

## Not built yet

File uploads/evidence storage, AI provider calls, SSO/passkeys, account deletion and
automatic audit-history retention. Each needs its own authorisation, retention and
threat review. Get an independent security review of authentication and tenant
isolation before the first real-client pilot.
