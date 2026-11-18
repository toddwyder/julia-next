# Retro: 18 Nov 2026 dependency upgrades (PRs #547–#559, JUL-403)

Scope: commits `8989e3f7` (JUL-403) and PRs #547–#559 (`d0fb2fd7`..`6fad3995`), plus the Antigravity session that shipped PR #559 and updated `ovh`.

## Candidates, ordered by severity

### 1. Automated checks: `.git/info/exclude` hides `.agents/skills/` from `git add`
- **Observed.** `.git/info/exclude` ignores `.agents/`. During PR #559, `.agents/skills/verify-two-writers-formally/SKILL.md` was written locally, passed `node scripts/check-skill-names.mjs`, and was silently omitted from `git commit` because `git add` was not forced (`git ls-files` shows `.agents/skills/verify-recipes-formally/SKILL.md` is tracked, while `verify-two-writers-formally/SKILL.md` is not).
- **Fix.** Either stop excluding `.agents/skills/` in `.git/info/exclude` (excluding only `.agents/` temp/cache paths if needed) or add a `repository-hygiene` check in `scripts/check-skill-names.mjs` that fails if a skill referenced by `formal/` has no tracked `SKILL.md`.

### 2. Automated checks: TLA+ model checks are not wired into CI and `tla2tools.jar` SHA256 drifted
- **Observed.** `package.json` defines `check:recipes-model`, and PR #559 added `scripts/check-two-writers-model.mjs`, yet neither runs in `.github/workflows/ci.yml`. In addition, `scripts/check-recipes-model.mjs` pins `tla2tools-1.8.0.jar` to `78f7e2c6...`, whereas downloading `v1.8.0` from GitHub in PR #559 produced `7e53aa63...`.
- **Fix.** Add `check:two-writers-model` to `package.json`, verify both `tla2tools-1.8.0.jar` hashes, and run `npm run check:recipes-model` and `npm run check:two-writers-model` in CI whenever `formal/` or covered flow/recipe files change.

### 3. Information access & deployment: `julia-flow-repo` and `julia-builder` on `ovh` do not auto-sync with `main`
- **Observed.** After PR #559 merged to `main` as `6fad3995`, `ovh` remained on `cc2c412` (`PR #558`) in both `/home/ubuntu/julia-flow-repo` and `/home/ubuntu/julia-builder` until pulled manually and `julia-studio.service` was restarted. Unlike `julia-dashboard.service`, Studio's checkouts have no pull-and-restart timer or post-merge hook.
- **Fix.** Add a lightweight idle-only sync check or documented post-merge step for `julia-flow-repo` and `julia-builder` when no card is active in Studio.

### 4. Automated checks: PR #558 shipped a sidecar workaround without a two-process span-destination test
- **Observed.** PR #558 (`cc2c412b`) resolved the DuckDB lock error by writing resumed spans to `trace-resume-${process.pid}.duckdb`. Its test in `machine/flow/start.test.mjs` checked only that `resumeCard` exited 0, not that resumed spans reached `trace.duckdb` or that no `trace-resume-*` files remained. PR #559 (`6fad3995`) replaced that with Studio HTTP API routing (`GET /api/workflows/card-path/runs/:runId`, `POST /api/workflows/card-path/resume-async`) and a two-process span check.
- **Fix.** Keep the two-process span assertion and `formal/flow/TwoWriters.tla` (`SingleWriter`, `NoSidecar`, `SpansInStudioTrace`) as required checks on `machine/flow/start.mjs`.

### 5. Automated checks: `check-agent-links.mjs` fails locally on vendored `.claude/skills/`
- **Observed.** Running `node scripts/check-agent-links.mjs` locally after PR #553 (`chore(skills): update Pocock skills to v1.3.2`) fails on three missing heading anchors in `.claude/skills/writing-beats/SKILL.md` and `.claude/skills/writing-shape/SKILL.md`.
- **Fix.** Either ignore vendored `.claude/skills/` anchors in `scripts/check-agent-links.mjs` or fix the upstream anchor targets when syncing Pocock skills.

### 6. Tool economy: Mastra/Next major-minor bumps required manual test & config follow-ups
- **Observed.** In the 18 Nov upgrade wave, bumping Mastra (`#554`) required updating `machine/flow/agents.test.mjs` (`RequestContext` instead of `Map`), enabling Next 16.4 Cache Components (`#556`) required updating `scripts/dynamic-route.test.mjs`, and Renovate's initial config (`#541`) needed follow-up PRs `#548` (group Mastra packages), `#549` (automerge), and `#550` (ignore vendored `.agents/skills`).
- **Fix.** Keep Renovate grouping (`#548`) and skill ignores (`#550`) covered by `scripts/renovate-config.test.mjs` so future dependency waves land in fewer PRs.
