# Audit workflow, version 1

## Goal

Run one complete statutory audit of a simple UK SME in Lines: an owner-managed
private company reporting under FRS 102 Section 1A or full FRS 102, with one entity
and no group. It must be good enough to demo to partners and to pilot with a design
partner. Target model and stages: `docs/domain.md` (engagement spine) and
`docs/workflows.md` (lifecycle).

## Approach

- Build the thinnest slice through the whole spine (area → assertion → risk →
  procedure → evidence → finding → conclusion → review/sign-off) before adding depth
  to any one stage.
- Every object is its own table with `firmId` and `engagementId` and composite foreign
  keys, like the rest of the schema. Changes are audited events and announced live.
- Stages guide and report progress; they don't lock work. Moving stage is an explicit,
  audited action that lists blockers (unreviewed work, open findings) rather than
  hiding pages.
- Records people edit together get a `version` column from the start (see
  `realtime.md`, edit safety).
- Lines ships one methodology, "Lines SME audit v1" (ISA (UK) based), as versioned
  data: standard areas, assertions, default risks, procedure templates and completion
  questions. Firms cannot edit it in V1. An engagement keeps the version it started
  with.

## Slices, in order

1. [x] **Files** (prerequisite): storage, upload security, the entity's permanent
       file. Evidence and engagement letters build on it.
2. [ ] **Acceptance and continuance.** Structured questions (integrity of owners,
       competence and resources, fees and non-audit services, ethical threats and
       safeguards), each team member's independence confirmation, the engagement
       letter as a file, and approval by the engagement partner (an RI). Moves the
       engagement out of SETUP.
3. [ ] **Trial balance.** Import current year and comparatives from CSV/Excel exports
       (Xero, QuickBooks, Sage first), check that it balances, map accounts to the
       standard financial statement areas, and carry mappings forward next year.
4. [ ] **Planning.** Materiality (benchmark, percentage, overall, performance,
       clearly trivial, with rationale), preliminary analytics (movement against
       last year, flagged over thresholds), understanding of the entity (structured
       sections, using the people and ownership data), fraud and going concern.
5. [ ] **Risk assessment.** Risks linked to areas and assertions, with likelihood,
       magnitude, significant and fraud flags. Presumed risks (revenue recognition,
       management override) are added by default and can only be rebutted with a
       reason.
6. [ ] **Fieldwork.** Procedures from the methodology's templates, linked to the
       risks and assertions they answer; the procedure lifecycle (to do → in progress
       → prepared → in review → completed); evidence attached from files; results and
       a conclusion per procedure; findings, with misstatements feeding a schedule of
       adjustments.
7. [ ] **Review and sign-off.** Review notes on any item, kept with their history;
       preparer and reviewer sign-offs; partner sign-off only by an RI. Changing
       signed work clears its sign-off. A blockers view for the manager and partner.
8. [ ] **Completion and reporting.** Completion questions (subsequent events, going
       concern, related parties, written representations), unadjusted differences
       against materiality, the overall conclusion and opinion, a draft auditor's
       report, then lock and archive (the file must be assembled within 60 days).
9. [ ] **Roll forward.** Start next year's engagement from this one: mappings, risks,
       procedures and permanent-file links carry over.

The first demo can stop after slice 7 with a hand-entered trial balance if import
takes longer than expected.

## Data model sketch

- `methodology_version` and its templates: seeded data, read-only for firms.
- `acceptance` (one per engagement), `independence_confirmation` (per team member).
- `trial_balance_line` (account code, name, current, prior), `fs_area`,
  `account_mapping`.
- `materiality` (one current row per engagement, earlier ones kept for history).
- `risk`, `risk_area`, `risk_assertion`; `procedure`, `procedure_risk`;
  `evidence` (a file plus provenance, linked to procedures); `finding`.
- `review_note` (item, thread, state), `sign_off` (item, role, user, time, item
  version).

## Questions for design partners

1. Do firms want to use their own bought-in methodology (for example ICAEW, Mercia or
   their Caseware templates), or would a good built-in one win them over?
2. Which accounting packages do their clients use, and how do they get trial
   balances today?
3. How much of acceptance and independence lives in their practice management
   system rather than the audit file?
4. What do they need to show an ICAEW or ACCA quality inspector, and how do they find
   it today?
5. Is the client portal (document requests) a reason to switch on its own?

## Not in version 1

Group audits, controls testing beyond documenting understanding, sampling tools
beyond recording the sample, statistical analytics, generating the financial
statements, and firm-editable methodology.
