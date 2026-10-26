---
name: verify-julia
description: "Drive Julia (the household Next.js web app) the way a user does on this Linux server: launch an isolated local server or point at a given address such as a Vercel preview, check it is the right build, drive the home page and install manifest in a named Playwright CLI browser, and keep the proof. Use after changing anything a user sees, or to check a candidate build or preview."
---

# Verify Julia

Julia is a Next.js web app. Its user surface today is one page (`/`) plus the install manifest and icons. `/api/health` is a machine check, not a user surface. There is no login, database or household data yet, so verification has no persistent side effect.

All commands run in bash from the repository root. Each command below reads the active run from `.artifacts/verify-julia/run.json`, so a new shell picks the run back up.

## Launch

Start one run. On a fresh checkout with no `node_modules`, launch runs `npm ci` first. If `package-lock.json` changed since the last install, run `npm ci` yourself before launch.

```bash
node .agents/skills/verify-julia/verify-julia.mjs launch                 # local candidate
node .agents/skills/verify-julia/verify-julia.mjs launch --url https://<preview-address>/   # a deployed build
eval "$(node -e 'const r=require("./.artifacts/verify-julia/run.json");console.log(`RUN_URL=${r.url} RUN_SESSION=${r.session} EVIDENCE=${r.evidenceDir}`)')"
```

Local launch picks a free port on 127.0.0.1, starts `next dev` in its own process group with its own `.next/verify-julia/<run>` output folder, and logs to `$EVIDENCE/server.log`. So it runs beside any other Julia server, including one on port 3000. Remote launch starts nothing.

Launch returns only when Julia is usable: `/api/health` answers `{"status":"ok"}` and `/` returns 200 with a `<main>` element. The first local compile takes about 10 to 30 seconds; the limit is 120 seconds. If Julia is not usable by then, including a `--url` that cannot be reached, launch exits 1 with `Julia did not become usable at <url>` and the last probe result. Launch writes `$EVIDENCE/launch.json` before it waits, and again with the readiness result, with the run ID, URL, browser session name, commit, branch, dirty flag, worktree SHA-256, and Node, Next.js and Playwright versions. It refuses to start while another run is active; run Cleanup first. If launch is interrupted or fails, run Cleanup: it stops the server launch started and keeps the evidence.

## Doctor

Run before driving and whenever anything looks wrong:

```bash
node .agents/skills/verify-julia/verify-julia.mjs doctor
```

It is read-only and writes `$EVIDENCE/doctor.json`. For a local run it checks that the commit and worktree digest still match the launch record (an edit since launch fails it), the server process is alive, and every listener on the port is in that process group. For both modes it checks that health and home are usable. A remote run reports `servedCommit` from `/api/health` (Vercel sets it); compare it to the commit you meant to check. Exit code 1 means do not drive. Clean up and launch again.

## Drive

Use the Playwright CLI bundled with the locked `@playwright/test` (see the `playwright-cli` skill for every command). Always pass this run's session, so you never touch another agent's browser:

```bash
pw() { npx --no-install playwright cli "-s=$RUN_SESSION" "$@"; }
pw open --browser chromium "$RUN_URL"
pw snapshot --filename "$EVIDENCE/home-snapshot.yml"
```

`--browser chromium` is required: without it the CLI looks for Google Chrome, which this server does not have. If Chromium is missing, run `npx --no-install playwright install chromium` once.

Find elements by role and text from the snapshot (`main`, the `Julia <version>` line, the welcome line), not by coordinates. Each feature in [features/README.md](features/README.md) gives the exact steps. Keep snapshots and console output in files; read only the parts you need.

For repeat checks, run the saved Playwright specs against this exact server. The helper sets `JULIA_VERIFY_URL`, so the Playwright config does not start its own server on port 3000:

```bash
node .agents/skills/verify-julia/verify-julia.mjs test .agents/skills/verify-julia/tests/home.spec.mjs
```

Each call appends its command, output and exit code to `$EVIDENCE/playwright-test.txt`, so separate calls for separate specs all stay in the proof. A nonzero exit is a failed proof.

## Evidence

Everything goes in `$EVIDENCE` (`.artifacts/verify-julia/<run-id>/`, git-ignored). A proof includes:

- `launch.json` and `doctor.json`, which say which build was checked.
- For each step, the action and what changed: the snapshot or text saved before and after, and a screenshot of the result.
- Real responses for anything that is not on screen. For example, save the manifest body and icon headers as files.
- `console-errors.txt` from `pw console error`. It must be empty, or explain each line.
- `playwright-test.txt` when you ran specs, and `server.log` for a local run.

Drive the real user path: open the URL and read what renders. Do not call internal functions or add test-only routes. Manifest and icon checks prove the browser can read them. They do not prove that installing on a phone works; say so when you report.

## Cleanup

```bash
node .agents/skills/verify-julia/verify-julia.mjs cleanup
ls "$EVIDENCE"
```

Cleanup closes this run's browser session, stops only the process group it started (SIGTERM, then SIGKILL after 5 seconds), removes that run's `.next/verify-julia/<run>` folder, and clears `run.json`. It never kills by name or port. It keeps `$EVIDENCE` and exits 1 if `launch.json` is missing afterwards. Run it after every failed attempt too.

## Helpers

`.agents/skills/verify-julia/verify-julia.mjs` (executable, Linux only, uses `ss` and `/proc`):

| Command | Does |
| --- | --- |
| `launch [--url <address>]` | Starts a local server, or records a deployed address, and waits until it is usable. |
| `doctor` | Read-only check that the run is worth driving. Exit code 1 means no. |
| `test <spec...>` | Runs Playwright specs against the run's URL and saves the output. |
| `cleanup` | Stops what launch started and keeps the evidence. |

Saved specs live in `tests/`. CI runs them through `scripts/test-owners.mjs`. Each feature gets one spec.
