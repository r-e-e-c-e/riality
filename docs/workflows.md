# Engagement Workflow

The standard engagement lifecycle is:

SETUP
-> INTAKE
-> PLANNING
-> RISK_ASSESSMENT
-> FIELDWORK
-> REVIEW
-> COMPLETION
-> REPORTED
-> ARCHIVED

These stages provide navigation and completion semantics.

They should not prevent legitimate audit work from overlapping where
professional workflow requires it.

## 1. Setup and acceptance

Built so far: firm owners/admins create a client, its legal entity, and a
statutory-audit engagement for a reporting period, then assign the team. Assigned
members can open their engagements. Not built yet: acceptance/continuance,
independence checks and methodology selection, so engagements stay in SETUP.
See `ui.md` for screens.

User:

- creates/selects client
- selects entity
- creates reporting period
- creates engagement
- assigns partner/manager/team
- chooses methodology
- performs acceptance/continuance
- performs independence/conflict checks

Output:

A formally accepted engagement.

## 2. Data intake

User:

- imports current-year trial balance
- imports comparatives
- maps accounts
- imports ledger/journal data where required
- uploads prior-year financial statements
- links previous Lines engagement if available

System validates:

- import integrity
- balance
- mappings
- periods
- missing/duplicate accounts

Output:

Canonical financial data suitable for audit planning.

## 3. Planning

User:

- records understanding of entity
- calculates materiality
- performs preliminary analytics
- identifies significant areas
- considers fraud
- considers going concern
- defines overall audit strategy

Output:

Approved planning basis.

## 4. Risk assessment

User:

- identifies risks of material misstatement
- links risks to financial statement areas
- links relevant assertions
- evaluates significance
- identifies significant/fraud risks
- documents relevant control understanding

Output:

Structured risk model for engagement.

## 5. Audit response / fieldwork

For each risk, auditors perform appropriate procedures.

Procedure lifecycle:

TODO
-> IN_PROGRESS
-> PREPARED
-> IN_REVIEW
-> COMPLETED

Auditors:

- perform tests
- select samples where applicable
- attach evidence
- document results
- record exceptions
- raise findings
- conclude on procedure

Output:

Evidence-backed responses to identified risks.

## 6. Findings

Findings may create:

- proposed audit adjustments
- unadjusted differences
- control recommendations
- additional procedures
- unresolved matters

Every finding must eventually be:

RESOLVED
or
ACCEPTED_WITH_JUSTIFICATION.

## 7. Review

Manager/partner:

- review procedures
- inspect risk coverage
- inspect evidence
- raise review notes
- clear review notes
- review findings
- approve conclusions
- provide required sign-offs

Lines prominently surfaces blockers.

## 8. Completion

Completion includes:

- final analytical review
- subsequent events
- going concern
- related parties
- written representations
- adjusted/unadjusted differences
- final materiality evaluation
- overall audit conclusion
- proposed audit opinion

## 9. Reporting

Primary external outputs may include:

- auditor's report
- final audited financial statements
- management letter
- schedule of audit differences
- representation letter

Lines V1 does not necessarily need to generate every financial statement itself.

## 10. Archive

When reporting is complete:

- final engagement is locked
- methodology version preserved
- audit trail preserved
- evidence retained
- sign-offs retained
- appropriate data can be rolled forward into next period
