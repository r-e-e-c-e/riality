# 0006 — Firm-scoped engagement setup and explicit team access

Status: accepted.

## Decision

Use a small engagements module with explicit client, entity, reporting-period,
engagement and team tables. Every relationship is firm-scoped with composite FKs.
Periods belong to entities; V1 has one statutory audit per exact entity/date range.
Engagements remain in setup until acceptance workflows exist.

Firm owners/admins manage setup metadata and assignments. Engagement content needs
both current firm membership and an explicit team assignment, including owners.
Auditor/manager/partner responsibilities are separate from administrative roles and
do not implement professional approval or sign-off. Creation assigns its creator
as manager. Membership removal removes assignments with transactional attribution;
rejoining requires reassignment.

Reuse remote functions and injected services. Team assignment changes take the
tenancy administration lock (see 0007 for the narrower lock scope). Do not add a generic permission engine, repositories,
new dependencies or infrastructure. Defer RLS while enforcing current permissions
on actual reads, database relationship constraints and restricted-role tests.

MFA disablement owns atomic verification inside its service. Invitation audit events
retain explicit IDs and keyed recipient fingerprints, without duplicating raw emails.

## Reason

This gives a solo founder a usable setup workflow and a concrete authorization
boundary for subsequent audit work. Stable firm IDs preserve the graph through
acquisitions. Team assignments keep administration separate from confidential
engagement content while staying small enough to understand and test.

## Consequences

Firm administrators can assign themselves; these grants are deliberate and audited.
The model is not designed to prevent a malicious authorised administrator granting
access. Routine audit work must use a narrower concurrency strategy when introduced.
Review/sign-off policies, methodology and acceptance remain separate next features.
RLS and independent security review remain review points before financial-data
rollout; code changes do not satisfy operational or compliance launch requirements.
