# Lines — Product Definition

## Mission

Lines is rebuilding professional financial work around structured data,
evidence, review and intelligent automation.

The first product is a modern cloud audit platform for accounting firms.

The immediate objective is not to replace every capability of incumbent audit
software. It is to create an exceptionally good system for completing
straightforward UK SME statutory audits.

Audit is the initial wedge.

Long-term, Lines may expand into adjacent financial workflows such as financial
close, controls, internal audit, continuous assurance and other trusted
financial operations.

Those future markets must not distort V1 architecture or product scope.

## Product thesis

Legacy audit software is heavily document-, checklist- and file-oriented.

Lines instead models the audit itself as structured relationships between:

financial information
-> assertions
-> risks
-> procedures
-> evidence
-> findings
-> conclusions
-> review
-> final opinion.

The product should make the current state of an audit obvious.

At any moment Lines should be able to answer:

- What remains incomplete?
- Which risks are insufficiently addressed?
- Which procedures lack evidence?
- Which findings remain unresolved?
- What requires reviewer attention?
- What prevents this engagement from being completed?

## Initial ICP

Independent UK accounting firms performing statutory audits of private SMEs.

Ideal initial firms are approximately 10-100 staff and have enough recurring
audit volume for workflow efficiency to matter while remaining small enough
for partners to make software decisions quickly.

Initial engagements should be relatively straightforward private-company
audits.

Typical characteristics:

- UK private limited company
- FRS 102 / applicable UK framework
- owner-managed or straightforward ownership
- ordinary trading company
- manageable ledger volume
- non-PIE
- no highly complex group structure

## Buyer

Likely economic buyer:

- audit partner
- managing partner
- head of audit

Primary users:

- audit associates
- seniors
- managers
- audit partners

## Customer value

Lines should eventually demonstrate measurable improvements in:

- engagement completion time
- preparation time
- review time
- consistency
- risk coverage
- visibility of outstanding work
- quality of documentation
- onboarding of junior staff

Beautiful UX is important, but it is not the value proposition by itself.

The product must materially improve audit economics and/or quality.

## Product principles

### Structured over document-centric

Important audit concepts should exist as domain objects rather than being
buried inside Word-like documents.

### Traceability

A reviewer should be able to move from a financial statement balance to the
risks affecting it, procedures responding to those risks, evidence supporting
those procedures and conclusions reached.

### Reviewer-first visibility

The system should make incomplete, contradictory or insufficient work obvious.

### Progressive complexity

Simple engagements should feel simple.

Complexity should appear only where the engagement requires it.

### Methodology as configuration

Audit methodology must not be hard-coded into application screens.

The product should eventually support multiple methodology versions and
jurisdictions through configurable rules and templates.

### Human judgement

AI assists auditors. It does not own the audit opinion.

## Explicit V1 non-goals

Do not build unless specifically prioritised:

- financial statement production
- corporation tax
- practice CRM
- billing
- time sheets
- broad resource scheduling
- complex consolidated/group audits
- PIE audit
- pensions
- public sector
- every accounting integration
- autonomous audit decisions
- general-purpose document management
