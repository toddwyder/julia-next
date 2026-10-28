# Handoff — 23 Oct 2026, 12:55 PT

Read first: `plans/path-forward.md` (project doc; also in the repo as `docs/plans/path-forward.md`), `principles/inverse-pyramid.md`, `retros/2026-10-23-jul-231-retro.md`.

## Where things stand
- **JUL-231 (Build) Complete.** Start runs one real pstack session in Mastra Code through the connection core (cap enforced). Services run from `/home/ubuntu/julia-machine-main` tracking main; old control page removed; Tailscale (`https://ovh.tail91f394.ts.net/julia-control`) points at the new page (port 43126). JUL-232 Complete.
- **pstack kept** (probation ended after the JUL-231 retro).
- **Path-forward plan agreed** (11:05–12:24): roles, flow, staging/smoke, UAT, merge, failures and board, retro, models and money, order of work. All in `plans/path-forward.md`.
- **First `/correct` run:** PR #317 merged (e3125ef) after Todd approved its lesson. It adds `scripts/check-agent-links.mjs`, which checks every link and path in AGENTS.md / CLAUDE.md / CODING_STANDARDS.md on every PR. Claude reran it: fails on the 3 cited past commits and on main before the PR, passes after. Finding: `/correct` only sees mistakes recorded in the repo, so the automatic retro must also be fed our retro notes.
- **PR #318 merged** (1009fde, 12:56 PT, after CI went green): `docs/plans/path-forward.md`, `docs/principles/inverse-pyramid.md`, AGENTS.md pointers, "on probation" dropped. Agents now read Todd's plan from the repo.

## Next step (agreed)
Card 1 of the order of work: **Models and money** (both subscriptions through Mastra Code sign-ins, $2/card cap, Sol's API price recorded, $0 rule retired, Claude-subscription ADR). The one-liner for the planner agent:
> Read `docs/plans/path-forward.md`. Run `/triage` with Todd for card 1 in its order of work.
Todd and the planner agent shape the card together; the advisor (Claude) checks evidence. Cards 1–4 are built by the planner agent in fresh sessions; the machine builds from card 5.

## How Claude works with Todd now (new today; also in memory)
- Roles are named by job: **planner agent** (today Codex), **machine**, **advisor** (Claude), Todd.
- Every fix goes as high in the pyramid as it will go; writing it in a file and hoping the agent follows is not a fix.
- Instructions to the planner agent are fixed one-liners; decisions live in cards and the repo, not in Claude's retelling.
- Don't just agree with Todd when he isn't right: say so plainly with the reason.
- Don't start new work without an agreed plan. One question at a time. Verify UI directions before giving them.

## Access
- GitHub is linked: `gh api` (REST) works; GraphQL doesn't. CI log downloads are blocked (Azure storage), so read failures through check annotations, which CI now writes per failing test.
- The server is not reachable from this session. Get server state by asking the planner agent to run a fixed readback script and push the raw output (see `claude-readback-20261023` branch). Card 2 replaces this with a status record pushed to GitHub.
- Network setting: couldn't be found in Todd's Projects UI; dropped.

## Open items in the plan with checkpoints
- **Evidence review:** reassess after five reviewed cards (goes into JUL-252 when triaged).
- **Cap:** review $2 after the next real card, with its token numbers. Measured floor: the one-line practice card took 54 requests (~130k fresh input, 13k output, 1.8M cache reads).
- **Watch only:** the builder session looked outside its worktree before starting (read Codex's checkout, checked sudo and gh auth). No change; fence only if it causes a problem.
