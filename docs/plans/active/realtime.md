# Live updates: what comes next

Live updates are built (see "Live updates" in `docs/architecture.md` and
`docs/decisions/0009-live-updates.md`). These are the remaining pieces, each with the
point at which it becomes worth building.

## To do

1. [ ] **Edit safety.** A `version` column on records people edit together; saves
       send the version they started from, and stale saves are refused with a
       conflict error and a "changed elsewhere" message. Decide whole-record or
       per-field, and autosave or explicit save, with the screen that needs it.
       _Build when:_ the first workpaper screen (procedures, findings, notes or review
       comments), where several team members edit the same records.
2. [ ] **Narrower refreshes after saving.** Forms that save often (autosave) list
       the queries they change, so the saving window stops refreshing everything
       (SvelteKit's default after a form submit).
       _Build when:_ autosave arrives.
3. [ ] **Presence.** "Who is viewing this engagement", sent over the same stream.
       _Build when:_ engagement work happens in the app and teams ask for it.
4. [ ] **One connection per browser.** A shared worker or leader window holds the
       stream for all of a browser's windows.
       _Build when:_ production cannot use HTTP/2, or users regularly keep many
       windows open.

## Not planned

- **Replaying missed events** (`Last-Event-ID`): after any gap, a window already
  refreshes everything it shows, which covers the same need.
- **Offline work**: revisit only with design-partner evidence.
