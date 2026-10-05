# 0009 — Live updates from the audit log

Status: accepted.

## Decision

Changes appear live in every open window, across users. An `AFTER INSERT` trigger on
`audit_event` sends a Postgres notification with IDs only. Each app server keeps one
`LISTEN` connection and streams matching changes to browser windows over
server-sent events (`/api/events`), filtered by firm membership and engagement team.
Windows refresh only the queries on screen that a change affects (`refreshOn`), never
the whole page.

Each window has its own connection; there is no leader window or cross-window state
sharing. Hidden windows wait until shown, and disconnect after a minute hidden.
Offline work is not supported.

## Why

The audit log already records every consequential change in the same transaction,
so notifications fire only for committed changes, with no second event system to
keep in step. Postgres is already required, so there is no Redis or broker to run.
SSE is plain HTTP and one-way, which is all the browser needs. Sending IDs rather
than data means a stream can never leak something the normal queries would refuse.

## Consequences

Production needs HTTP/2 and a database connection that supports `LISTEN` (not a
transaction-mode pooler). The window that made a change fetches its queries again
too (SvelteKit's default after a form submit, plus the live update); this is cheap,
and forms can narrow it with explicit refreshes later. If notification volume or
window counts grow large, options are a shared worker or leader window per browser,
and a separate fan-out service; neither is needed yet.
