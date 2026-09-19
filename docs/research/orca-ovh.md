# What is "Orca on the OVH server", and what can it run?

Research for Linear JUL-10. Written 2026-09-15 against the frozen `toddwyder/Julia` repo, the
`toddwyder/AI-Stack` repo (where the server setup actually lives), and Orca's own documentation.
Plain-language glossary at the end.

## The short answer

**Orca is not a place where the Julia app runs. It is the tool that runs the AI agents that
write Julia.** The OVH server is a small rented Linux computer (about $11/month) whose job is to
host Orca and run Julia's test gate, so that agent work happens on a machine that is always on
instead of on Todd's laptop.

So when the restart ADR says "Orca on the OVH server is the only route for work", it means:
*every code change must be produced by an agent dispatched through Orca on that server, and
published through the server's publisher identity — never by an agent on a laptop pushing
directly.* It does **not** say where the finished app will be hosted. In the old setup the app
itself ran on **Vercel** (the website) and **Firebase/Google Cloud** (the database, file storage
and background functions). The OVH server never served the app to anyone.

The ticket's sub-questions (languages, databases, background jobs, custom domains, HTTPS,
secrets) are therefore questions about *the app's hosting*, which the restart has not yet
chosen. They are answered below as far as the evidence allows, and the rest is listed under
"Still unknown".

## 1. What Orca is

Orca is a free, open-source (MIT-licensed) desktop application from a company called Stably.
Its own description: "Orca is the ADE for working with a fleet of parallel agents. Run any
coding agent with your own subscription. Available on desktop, mobile and remote runtime."
([GitHub: stablyai/orca](https://github.com/stablyai/orca)). "ADE" is their term for "agent
development environment" — think of it as a control room for several AI coding agents at once.

What it does, in plain terms:

- **Runs coding agents side by side.** It launches tools such as Claude Code and Codex (and
  others) in their own terminals, each in its own copy of the code (a Git "worktree"), so they
  cannot trample each other. ([Orca docs: What is Orca?](https://www.onorca.dev/docs))
- **Uses your existing subscriptions.** Orca itself costs nothing; the agents run on the
  Claude / OpenAI accounts you already pay for. There is no "Orca Pro" tier — the product page
  says "Free and open source for macOS, Windows, and Linux".
  ([Orca install docs](https://www.onorca.dev/docs/install)) (The "pay for Pro" question in
  the Sep 13 retro was about *GitHub* Pro, which the team declined — see `RETRO-2026-09-13.md`.)
- **Orchestration.** A coordinator agent can create Tasks, dispatch them to worker agents, wait
  for each worker's `worker_done` report, and mark tasks `completed`/`failed`/`blocked`. This is
  the feature Julia's "coordinator" playbook is built on.
  ([Orca docs: Orchestration](https://www.onorca.dev/docs/cli/orchestration))
- **Scheduled automations.** Orca can run a prompt on a schedule (hourly, daily, cron) to start
  an agent without anyone clicking. This is what AI-Stack's plan uses as the "wake-up" for the
  coordinator. ([Orca docs: Scheduled automations](https://www.onorca.dev/docs/cli/automations))
- **Remote Orca Server.** "A Remote Orca Server lets one computer do the work while another
  computer provides the UI." The server "owns projects, worktrees, terminals, and agent
  processes; clients are the UI." On a machine with no screen you start it with
  `orca serve --pairing-address <tailscale-ip>`. It is marked **beta**, must be kept on a
  private network (Tailscale), and the agent CLIs must be installed and signed in *on the
  server*. ([Orca docs: Remote Orca Servers](https://www.onorca.dev/docs/remote-servers),
  [Ways to run Orca](https://www.onorca.dev/docs/ways-to-run))
- **Not a hosting service.** "Orca does not sell managed VPS hosting. Remote modes always use
  machines and cloud accounts you control." ([Ways to run Orca](https://www.onorca.dev/docs/ways-to-run))

Version facts: the runner pins Orca `1.4.200`; the newest published release on 2026-09-15 is
`v1.4.203`, shipped as `.deb`, `.rpm`, AppImage, macOS and Windows installers
([releases](https://github.com/stablyai/orca/releases)). On Linux the command is `orca-ide`
(not `orca`) to avoid clashing with the GNOME screen reader of the same name
([install docs](https://www.onorca.dev/docs/install)).

## 2. What the OVH server is

All of this is documented in `toddwyder/AI-Stack`, not in the Julia repo.

| Fact | Value | Source |
|---|---|---|
| Provider / plan | OVH VPS-2, US-West (Oregon), month-to-month, backup included, $10.92/month | `cloud-runner-setup.md` (AI-Stack PR #119) |
| Size | 4 vCores, 8 GB RAM, 75 GB NVMe, Ubuntu 24.04 | same |
| Delivered | 2026-09-11 | same |
| How it is reached | Only over Tailscale (a private network), at `100.125.239.98`; public SSH removed; firewall denies all public inbound | AI-Stack `AGENTS.md`; `ops/orca-runner/README.md` (PR #118) |
| Why it exists | "move Orca/Julia work off Todd's 16 GB laptop … stable memory, survive laptop sleep, and keep production credentials away from workers" | `cloud-runner-setup.md` |
| Nickname in the repos | `orca-runner` / "the cloud runner" | throughout AI-Stack |

What the bootstrap script installs on it (`ops/orca-runner/bootstrap-runner.sh`, PR #118):

- Node.js 22, Java 21 (needed by the Firebase emulators), Python 3 (the old Julia's Cloud
  Functions were Python), the Firebase CLI, Playwright's Chromium libraries.
- A non-admin `runner` account with no `sudo`.
- The Orca server from its published `.deb`, run headless by a systemd service
  (`orca-ide serve --pairing-address <tailnet-addr> --port 6768`), reachable only on the
  Tailscale interface.
- A read-only clone of Julia using a deploy key that **cannot push** ("Allow write access"
  left unchecked on GitHub, and the clone's push URL set to `DISABLED_READ_ONLY_RUNNER`).
- The Claude Code and Codex CLIs, installed but deliberately **not signed in** — signing in is
  Todd's browser-approval step.

Important caveat: PR #118 (bootstrap + README) and PR #119 (setup document) are still **open,
unmerged** as of 2026-09-15. The scripts were run live on the server during the 2026-09-12
canary, but they are not yet on AI-Stack's `main`. Only the heartbeat check (PRs #112, #114)
is merged.

Health monitoring: a GitHub Actions workflow (`.github/workflows/orca-runner-heartbeat.yml`)
joins the tailnet hourly (4am–10pm Pacific), runs a read-only validator over SSH, and opens or
closes a single GitHub issue titled "Cloud runner unavailable". It never restarts, deploys or
publishes anything. AI-Stack issue #111 shows it working (failure on 2026-09-12, recovered same
day).

## 3. What "Orca on the OVH server" can run — the ticket's checklist

The honest framing: Orca runs *agents and their tests*; it does not run *apps for users*. So:

| Question | Answer for Orca / the runner | Answer for the app (old setup) |
|---|---|---|
| Languages / runtimes | Anything installed on the box; today Node 22, Java 21, Python 3. Orca itself is language-agnostic — it just runs command-line tools. | Old app: Next.js (TypeScript) on Vercel; Python Cloud Functions on Firebase. |
| Databases | None served. The Firebase **emulators** (fake local Firestore/Auth/Storage) run there during test gates, bound to all interfaces but shielded by the firewall — the README calls that firewall rule "load-bearing". | Old app: Firestore (project `julia-44bd9`), plus a separate `julia-preview` project for previews. |
| Background jobs | Orca **automations** (scheduled prompts) run agent jobs on the server. That is for development work, not app features. | Old app: a daily Vercel cron (`vercel.json` → `/api/recipes/drip-worker`) and Firebase Cloud Functions. |
| Custom domains | Not applicable. Orca is deliberately never exposed to the public internet ("Never expose Orca publicly"). | Old app was at `julia-mu-green.vercel.app`; no custom domain found in the repo. |
| HTTPS | Not applicable for the same reason; traffic is inside Tailscale. | Vercel provides HTTPS automatically. |
| Environment variables / secrets | By design the server holds **no production credentials**. Worker processes have GitHub tokens stripped (`scripts/run-sandboxed-worker.mjs`). The only GitHub write credential is the `julia-graph-publisher` GitHub App, meant to live on the server for the publisher role only. | Old app secrets lived in Vercel project environment variables (Firebase Admin key, Gemini, Imagen, Jina, USDA keys) — see `docs/credentials-map.md` in the old repo. |

Capacity note from the setup doc: Julia's test gate "peaks near 4 GB"; 8 GB is "the minimum
viable runner size, not a comfortable one"; gates must run one at a time. Orca's session
restore keeps agents alive if the UI closes, but **not across a server reboot**.

## 4. How a change gets from the repo to a running app

This is the path as designed and partly proven in the old setup. Steps marked *proven* were
demonstrated with evidence; steps marked *designed* are in the playbooks but not yet shown
working end to end on the server.

1. **Wake-up** — an Orca scheduled automation on the server starts a fresh "coordinator"
   agent (Claude Code) on a schedule or when something changed. *(designed: AI-Stack
   `RETRO-2026-09-13-PLAN.md`, Round B item 4; D9 in `DECISIONS-2026-09-10.md`)*
2. **Admit an issue** — the coordinator picks the top eligible GitHub issue (criteria approved,
   one route label, dependencies closed). *(designed: `.claude/skills/julia-coordinator/SKILL.md`)*
3. **Dispatch a worker** — for each step, Orca creates a Task and starts a fresh worker agent
   in its own worktree on the server. The worker cannot push: no GitHub token, read-only deploy
   key, and a pre-push hook that refuses. *(proven for the mechanics on the server: AI-Stack
   #117 canary report; Julia PR #189)*
4. **Worker commits; the gate runs** — the commit hook runs Julia's full gate (lint, types,
   tests, build, emulator tests). The coordinator then re-runs the gate independently on the
   same commit. *(proven on the server, 268 s and 270 s: Julia PR #189)*
5. **Codex reviews the change** — read-only, at most two passes. *(proven on the server after a
   sandbox fix: AI-Stack PR #116/#121)*
6. **Publisher opens a draft PR** — the only component with GitHub write access, using the
   `julia-graph-publisher` GitHub App (App ID 4948330). A CI check (`publisher-only-pr.yml`)
   fails any PR not opened by that App. *(App proven live on a throwaway PR; **the server-side
   publish has not yet been demonstrated** — in the #189 canary the commit was fetched to the
   laptop and pushed from there. AI-Stack `STATUS.md`, "In flight — Round B1")*
7. **PR gate in GitHub Actions** — `pr-gate.yml` runs lint, type-check, tests, `next build`,
   and emulator regression tests on every PR to `main`, and writes a `gate-verdict` check.
   *(old Julia repo, proven in use)*
8. **Preview for Todd** — Vercel builds a preview deployment per PR; the coordinator publishes
   a one-page human brief at `/uat` and parks the item for Todd's acceptance. *(designed;
   previews were blocked on missing Firestore credentials — Julia #201)*
9. **Merge → production** — merging to `main` triggers Vercel's production deploy;
   `production-health.yml` then calls the live health endpoint. *(old repo, proven in use)*

Where Orca sits: steps 1, 3, 5 and the task bookkeeping. Where the OVH server sits: it is the
machine steps 1–6 run on. Where the app runs: steps 8–9, on Vercel + Firebase in the old
design, **undecided for the new one**.

A cautionary fact from the retro: for a period the coordinator actually ran "in Anthropic's
cloud on a scheduled routine" while "the server and laptop are idle", contrary to the design,
and nobody noticed until Todd asked why he couldn't see it in Orca. The fix chosen was
mechanical, not a rule: delete the cloud routine, keep the only GitHub write key on the server,
and have CI reject PRs from anyone but the publisher (`RETRO-2026-09-13.md`, "the mechanical
fix"). The ADR's "enforced before any code exists" is this fix applied to `julia-next`.

## 5. What this means for the new app

- **Two separate decisions, not one.** "Orca on the OVH server" settles *how work is done*
  (agents on the runner, publisher-only writes). It does not settle *where Julia runs*. JUL-11
  ("Technical foundation") needs a hosting decision; the old answer was Vercel + Firebase.
- **The server is the wrong place to host the app.** It is 8 GB with 4 GB already needed per
  gate run, has no public inbound traffic by design, and keeping it credential-free is the
  whole point. Hosting the app there would undo that boundary.
- **Whatever hosting is chosen must fit the pipeline above:** a preview per PR that Todd can
  open signed-out, a production deploy on merge, and a health check afterwards. Vercel did all
  three in the old repo with no server-side work.
- **Runtime constraints for the gate:** anything the new app's tests need must be installable
  on Ubuntu 24.04 within ~4 GB. The old gate's Java (Firebase emulators) and Chromium
  (Playwright) are already there; a different database would change this list.
- **Bootstrap `julia-next` on the runner is new work.** The runner today has a read-only clone
  of the *old* `toddwyder/Julia`, a deploy key registered on that repo, and the publisher App
  installed only on `Julia` and `AI-Stack`. All three need repeating for `julia-next`.
- **Finish Round B first.** The publisher-from-server path and the "Orca automation as the
  wake" have not been demonstrated. Until they are, "the only route for work" is a rule, not a
  mechanism — exactly what the retro warned against.

## 6. Still unknown / Todd needs to confirm

1. **Is the server still up and paired?** The last recorded health-check state is "recovered
   2026-09-12". AI-Stack `STATUS.md` says to read issue #113's thread "before trusting either
   'open' or 'runner standing'". Nothing here was re-verified live.
2. **Are Claude Code and Codex signed in on the server?** Julia #201 says "Claude Code on the
   OVH server (signed in there…)", but the bootstrap README says sign-in is Todd's manual step
   and is not recorded anywhere as done.
3. **Is the Orca server service running, and is Todd's laptop paired to it as the UI?**
   Round B item 5; no evidence either way.
4. **Where will the new app be hosted?** Not in any repo document. Vercel + Firebase is the
   precedent; the ADR only mentions Sentry and Axiom for observability.
5. **Does the OVH box need to grow?** 8 GB is "minimum viable"; parallel workers (retro,
   "fan-out") were deferred partly for this reason.
6. **Custom domain and HTTPS** for the new app — nothing in either repo mentions a domain.
7. **Should PRs #118 and #119 be merged** so the server setup is on `main` and not only in
   open PRs? An agent rebuilding the server today would have to know to look in those PRs.

## Glossary

- **VPS** — a rented virtual computer in a data centre; you get root access and pay monthly.
- **Tailscale / tailnet** — a private network between your own devices; nothing on the public
  internet can reach the server, only devices in the tailnet.
- **Worktree** — a separate folder checkout of the same Git repository, so two agents can edit
  in parallel without interfering.
- **Gate** — Julia's bundle of checks (lint, types, tests, build) that a commit must pass.
- **Publisher** — the one identity allowed to write to GitHub (open PRs, comment). Workers are
  not it.
- **Deploy key** — an SSH key tied to one repository, which can be made read-only.
- **Coordinator / worker** — the coordinator agent decides and verifies; worker agents do the
  actual coding, one fresh worker per step.

## Sources

Repositories (private; read via `gh` on 2026-09-15):

- `toddwyder/julia-next` — `docs/adr/0001-restart.md`
- `toddwyder/Julia` — `CLAUDE.md`, `AGENTS.md`, `docs/credentials-map.md`,
  `.claude/skills/julia-coordinator/SKILL.md`, `scripts/run-sandboxed-worker.mjs`,
  `scripts/publish-via-github-app.mjs`, `vercel.json`, `firebase.json`,
  `.github/workflows/{pr-gate,publisher-only-pr,production-health}.yml`,
  issue #201, PR #189 (canary)
- `toddwyder/AI-Stack` — `AGENTS.md`, `STATUS.md`, `DECISIONS-2026-09-10.md`,
  `RETRO-2026-09-13.md`, `RETRO-2026-09-13-PLAN.md`, `ops/orca-runner/heartbeat-check.sh`,
  `.github/workflows/orca-runner-heartbeat.yml`, `orchestrator/README.md`;
  PR #118 (`ops/orca-runner/{README.md,bootstrap-runner.sh,runner-config.example}`, open),
  PR #119 (`cloud-runner-setup.md`, open), PR #116/#121 (Codex sandbox fix),
  PR #112/#114 (heartbeat, merged), issues #111, #117

Orca (vendor, public):

- https://github.com/stablyai/orca — README, MIT license, releases (`v1.4.203`, 2026-09-15)
- https://www.onorca.dev/docs — What is Orca?
- https://www.onorca.dev/docs/install — install options, `orca-ide` naming, "Free and open source"
- https://www.onorca.dev/docs/ways-to-run — local / SSH / remote server / cloud VM; "does not sell managed VPS hosting"
- https://www.onorca.dev/docs/remote-servers — Remote Orca Server, `orca serve`, beta, Tailscale
- https://www.onorca.dev/docs/cli/orchestration — Runs, Tasks, Dispatches, `worker_done`
- https://www.onorca.dev/docs/cli/automations — scheduled automations
- https://github.com/stablyai/orca/blob/main/docs/reference/headless-linux-server.md — headless Linux service setup
