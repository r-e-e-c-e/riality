# UI organisation

The UI shows implemented tasks and real audit state: no invented deadlines, progress
metrics, review queues or sign-off controls. Lines branding appears only on the
sign-in screens; inside the app, the firm is the brand.

## Firm workspaces

Each firm is a workspace at `lines.ws/{handle}` (for example `/baldwyn-co`), like a
Slack workspace. `lines.ws/` opens the user's last-used firm, or `/welcome` if they
have none yet.

Header, left to right:

1. **Workspace switcher**: the current firm's name. It opens the user's firms A–Z
   (current one ticked) and "Create a firm". Ownership groups are not shown as a
   tree: switching is about work, not ownership. A firm's group appears as muted
   text only when the user's firms span several groups, and a search box appears
   when they have more than seven firms. A group-level view belongs to a future
   group-oversight feature.
2. **Navigation**: Dashboard, Clients, Engagements, and Settings for owners and admins.
3. **Avatar menu**: initials on the user's chosen colour, opening Manage account and
   Sign out.

Account pages (`/account`, `/welcome`, `/new-firm`) keep the header, with the
last-used firm's navigation.

## Pages

| Page                              | Who      | Shows                                                                     |
| --------------------------------- | -------- | ------------------------------------------------------------------------- |
| `/{handle}` Dashboard             | Everyone | Engagements you're assigned to; admins get shortcuts to create and invite |
| `/{handle}/clients`               | Everyone | Clients and entities (admins: all, with add forms; members: their own)    |
| `/{handle}/engagements`           | Everyone | Admins: every engagement; members: their own                              |
| `/{handle}/engagements/new`       | Admins   | Pick an entity and period; add a client or entity inline                  |
| `/{handle}/engagements/{id}`      | Team     | Entity, period, status, your responsibility, the team                     |
| `/{handle}/engagements/{id}/team` | Admins   | Assign and change team responsibilities                                   |
| `/{handle}/settings`              | Admins   | Team (members, invitations) and Firm (name, handle; owners edit)          |
| `/account` Manage account         | Everyone | Profile (name, avatar colour), MFA, password, sessions, account summary   |

Firm administration (owner/admin) and engagement responsibilities (auditor/manager/
partner) have different labels and explanations. Opening an engagement always needs
a team assignment.

## Interaction rules

- Use URLs for context, remote functions for data, and native forms plus
  `<details>`/`<summary>` for menus and disclosure, so everything works without
  JavaScript. Forms reopen when they contain errors.
- Keep keyboard access, accessible names, visible focus and responsive layouts.
- Shared components cover the header, avatar, engagement rows, form feedback and
  error details only; avoid a navigation framework or generic form renderer.
- Changes need a deliberate submit. Scope repeated form instances to the record they
  change. If you remove or demote yourself, you are redirected to a page you can
  still open.
- Hiding links is presentation only; every remote function checks access itself.
