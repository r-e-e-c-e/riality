# Privacy and UK GDPR

Implementation notes and work needed before a live pilot. Not a privacy notice, legal
advice or certification. The founder owns these procedures until named owners are
assigned. Keep evidence outside the repository.

## Data we hold

- **Accounts:** name, email, password hash, MFA secret (encrypted), recovery-code
  hashes, sessions.
- **Firms:** tenant names, memberships, invitations.
- **Engagement setup:** client and entity names, reporting dates, engagements, team
  assignments.
- **Client people:** names of directors, shareholders, PSCs and contacts, optional
  email and phone, and (from Companies House only) month and year of birth and the
  officer ID, used to recognise the same person across companies. We do not copy
  nationality, occupation or addresses from the register.
- **Audit history:** who did what, when, with IDs and typed details. No names copied
  in, no raw emails (invitations use a keyed fingerprint), no secrets.
- **Logs:** request lines and security events with keyed fingerprints instead of raw
  emails or IPs. Fingerprints are pseudonymous personal data, not anonymous.

There are no analytics or tracking cookies; the session cookie is strictly necessary.
Lines is likely controller for account/security data and processor for firms'
client/audit data. Confirm this in customer contracts. Development and tests use
synthetic data only.

## Retention

Expired records are deleted by the hourly cleanup job in the app.

| Data                                      | Lifetime                                                     |
| ----------------------------------------- | ------------------------------------------------------------ |
| Signup / reset codes                      | 60 / 20 minutes, one use                                     |
| Invitations                               | 7 days, or until accepted/revoked                            |
| Sessions                                  | 7 days maximum, 30 minutes idle                              |
| Unconfirmed MFA setup                     | 10 minutes                                                   |
| Rate-limit counters                       | Window length (15–60 minutes)                                |
| Queued email                              | Until sent, or until its link expires                        |
| MFA and recovery codes                    | Until MFA is removed                                         |
| Profiles, memberships, engagement records | Account/customer lifecycle; no automatic deletion yet        |
| Audit history                             | No automatic deletion yet; needs a justified schedule        |
| Logs and backups                          | Decide before launch (start with about 30 days, then review) |

Append-only history is an integrity control, not permission to keep personal data
forever. Erasure may need controlled pseudonymisation that keeps required attribution.
Never truncate audit events to meet a request.

## Individual rights

1. Log the request (who, when, scope) in a secure register and verify identity
   proportionately.
2. Decide whether Lines is controller, or must help the customer firm as processor.
3. Account security offers a self-service summary (profile, memberships, up to 1,000
   events). It is not a complete subject-access response; also check logs, customer
   records and suppliers.
4. Send exports through an authenticated channel. Never email financial exports.
5. Offboarding: hand over sole ownership, then `auth:disable`. Agree profile
   erasure/pseudonymisation and event retention with the controller.
6. Record what was done, and why any data was kept.

## Suppliers

Before going live, record each supplier (hosting, Resend, Have I Been Pwned, Companies
House): purpose,
data, region, retention, DPA, sub-processors and transfer safeguards. Resend receives
recipient addresses and email content (sign-in links, firm names). HIBP receives only
a 5-character password-hash prefix. Companies House receives company numbers and
search terms (public register data, no personal data from Lines).

## Incidents

Keep a tested escalation procedure:

1. Contain: revoke sessions and credentials.
2. Preserve sanitised evidence.
3. Find which tenants and data were affected.
4. Notify customer controllers without undue delay.
5. Report notifiable breaches to the ICO within 72 hours of becoming aware.
6. Record the assessment even when no report is needed.

## Before the first real-client pilot

- Publish a privacy notice (controller, contact, purposes, lawful bases, recipients,
  retention, rights) linked from signup.
- Sign customer DPAs, complete the supplier register and assess whether a DPIA is
  needed.
- Approve retention schedules, including logs and backups.
- Complete the checks in `operations.md` (access, secrets, backup restore, incidents).
- Get an independent review of authentication and tenant isolation.

ISO 27001 and SOC 2 need an operating security management system with evidence:
risk register, access reviews, change records (PRs plus CI), restore tests and
incident records. The code supports this but does not provide it.
