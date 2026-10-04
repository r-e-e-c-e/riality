# Lines Domain Model

## Organisational hierarchy

Lines is multi-tenant.

OrganisationGroup
  -> Firm
      -> Office
      -> Team
      -> User

A Firm may exist without an OrganisationGroup.

This is intentional.

A standalone accounting firm must be able to become part of a larger group
later without migrating its audit history.

Groups are not an important V1 user-facing feature.

## Client model

Firm
-> Client
-> Entity
-> Engagement
-> Period

A Client represents the firm's customer relationship.

An Entity represents a legal/reporting entity.

A Client may eventually contain multiple Entities.

An Engagement represents one professional engagement performed for an Entity
for a particular reporting period.

V1 engagement type:

STATUTORY_AUDIT

## Engagement spine

The fundamental audit relationship is:

FinancialStatementArea
-> Assertion
-> Risk
-> Procedure
-> Evidence
-> Finding
-> Conclusion
-> Review / SignOff

These relationships must remain explicit and queryable.

## Financial statement area

Represents an auditable area or balance/category.

Examples:

- Revenue
- Trade receivables
- Cash
- Inventory
- Fixed assets
- Trade payables
- Payroll
- Equity

Areas may be populated by mapped trial-balance accounts.

## Assertions

Assertions describe what management implicitly asserts about financial
information.

Examples include:

- existence
- occurrence
- completeness
- accuracy
- valuation
- rights and obligations
- classification
- presentation
- cut-off

Exact applicability depends on the area and methodology.

## Risk

A Risk represents a risk of material misstatement.

A risk should contain structured information such as:

- description
- affected areas
- affected assertions
- source/rationale
- likelihood
- magnitude
- significant-risk status
- fraud-related status
- assessment
- owner
- status

A risk must be capable of linking to multiple procedures.

## Procedure

A Procedure represents audit work undertaken in response to one or more risks.

Typical fields:

- objective
- instructions
- linked risks
- linked assertions
- assignee
- preparer
- reviewer
- status
- result
- conclusion
- evidence
- findings

Procedures are first-class objects.

Do not model a procedure merely as rich text inside a document.

## Evidence

Evidence represents information used to support audit work.

Evidence should retain:

- source
- provenance
- original filename/object
- uploader
- upload date
- client-provided vs auditor-generated
- relevant period
- links to procedures
- links to findings
- review state

Original source files should be preserved.

## Finding

A Finding represents something requiring evaluation or resolution.

Possible types:

- misstatement
- proposed adjustment
- control deficiency
- testing exception
- missing evidence
- unresolved audit matter
- inconsistency

Findings should have explicit resolution state.

## Conclusion

A conclusion records the professional conclusion reached after considering
procedures, evidence and findings.

Conclusions must be attributable to a user and time.

## Review

Review is structured workflow rather than generic comments.

Possible review states include:

- prepared
- awaiting review
- review note raised
- response provided
- cleared
- signed off

Review notes should preserve their history rather than disappearing when
resolved.

## Sign-off

Sign-offs should record:

- user
- role
- timestamp
- item/version signed
- relevant methodology version

Changing signed work may invalidate or require renewed sign-off.

## Methodology

A Methodology defines what an engagement requires.

MethodologyVersion
-> Section
-> Requirement
-> Question
-> ProcedureTemplate
-> ApplicabilityRule
-> SignOffRequirement

Methodology versions are immutable once used by completed engagements.

An engagement should retain the methodology version under which it was
performed.

## Audit trail

All consequential changes must produce attributable audit history.

Important events include:

engagement.created
engagement.accepted
trial_balance.imported
materiality.changed
risk.created
risk.assessed
procedure.started
procedure.completed
evidence.attached
finding.raised
finding.resolved
review_note.raised
review_note.cleared
signoff.completed
engagement.completed
engagement.locked

The domain event vocabulary may evolve, but auditability must remain.

## Important invariant

The application should be able to determine:

- risks without adequate responses
- procedures without evidence/conclusions
- material areas without appropriate coverage
- unresolved findings
- unresolved review notes
- missing required sign-offs
- blockers preventing engagement completion