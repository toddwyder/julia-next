# Issue tracker: Linear

Issues and specs for this repo live in Linear, team **Julia-next**. Use the Linear MCP tools
(`mcp__linear__*`) for all operations. Load their schemas first with one `ToolSearch` call, e.g.
`select:mcp__linear__list_issues,mcp__linear__get_issue,mcp__linear__save_issue,mcp__linear__save_comment,mcp__linear__list_comments`.

Issue identifiers look like `JUL-12`. Refer to issues by **title** in anything a human reads; the
identifier rides inside the link.

## Conventions

- **Create an issue**: `save_issue` with `team: "Julia-next"`, `title`, `description` (Markdown,
  literal newlines), and `labels`.
- **Read an issue**: `get_issue` (add `includeRelations: true` for blocking); `list_comments` for
  the thread.
- **List issues**: `list_issues` with `team: "Julia-next"` plus `label`, `state`, `assignee`, or
  `parentId` filters.
- **Comment on an issue**: `save_comment` with `issueId` and `body`.
- **Apply / remove labels**: `save_issue` with `id` and `addLabels` / `removeLabels`.
- **Close**: `save_issue` with `id` and `state: "Done"` (or `"Canceled"` for out-of-scope).
- **Assign**: `save_issue` with `id` and `assignee: "me"`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature
requests; `/triage` reads this flag.)_

When set to `yes`, external PRs are read with `gh pr view <number> --comments` and `gh pr diff`,
then mirrored into Linear as issues carrying the same labels and states.

## When a skill says "publish to the issue tracker"

Create a Linear issue on team Julia-next.

## When a skill says "fetch the relevant ticket"

`get_issue` with the identifier, then `list_comments` for the discussion.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets. The current
map is **Julia restart: chart the way to a v1 spec** (`JUL-5`).

- **Map**: a single issue labelled `wayfinder:map`, holding the Destination / Notes /
  Decisions-so-far / Not-yet-specified / Out-of-scope body.
- **Child ticket**: an issue created with `parentId` set to the map. Labels: `wayfinder:<type>`
  (`research` / `prototype` / `grilling` / `task`). Once claimed, the ticket is assigned to the
  driving dev.
- **Blocking**: Linear's **native** blocked-by relation, the canonical, UI-visible representation.
  Add an edge with `save_issue` using `id: <child>` and `blockedBy: ["<blocker>"]`. A ticket is
  unblocked when every blocker is Done or Canceled.
- **Frontier query**: `list_issues` with `parentId: "JUL-5"`, open states only; drop any with an
  open blocker (`get_issue` with `includeRelations: true`) or an assignee; first in map order wins.
- **Claim**: `save_issue` with `assignee: "me"`, the session's first write.
- **Resolve**: `save_comment` with the answer, then `save_issue` with `state: "Done"`, then append
  a context pointer (gist + link) to the map's Decisions-so-far using `save_issue` with `patch`.
- **Rule out of scope**: `save_issue` with `state: "Canceled"`, then add one line to the map's
  Out-of-scope section.
