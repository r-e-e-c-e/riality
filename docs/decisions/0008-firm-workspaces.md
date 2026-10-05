# 0008 — Firm workspaces at /{handle}

Status: accepted.

## Decision

Each firm is a workspace at `lines.ws/{handle}`, with the firm name (not Lines) first
in the header as a Slack-style switcher, followed by Dashboard, Clients, Engagements
and Settings (owners/admins), and an initials avatar menu. Lines branding is limited
to the sign-in screens. `lines.ws/` opens the last-used firm (`app_user.last_firm_id`).

Handles are unique, lowercase and hyphenated, never reserved route names, and
editable by owners. Old handles are not redirected. Groups have no handle or
dashboard. The switcher is a flat A–Z list of firms with search for people in many
firms; ownership structure is not shown there, because it does not help people
pick where to work and changes with every acquisition.

Owners and admins manage the team; only owners touch ownership and firm details.
Users create standalone firms only. Group creation and moves are audited operator
commands, because adopting a firm into a group is a commercial agreement, not a
self-service action.

Avatars use initials on a chosen colour. Image upload waits for evidence storage, so
uploads get one storage design and one security review.

## Consequences

URLs read well and survive renames of the firm name (not of the handle). Services
keep using firm IDs; only the workspace lookup takes a handle. The root redirect is
the app's single server `load`, because it only redirects. Billing is not built;
Settings gets a Billing section when a provider is chosen.
