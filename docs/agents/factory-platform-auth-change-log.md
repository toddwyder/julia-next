# Factory platform sign-in setup: change list

Date: 2026-09-27. Scope: authentication setup after the completed JUL-183 trial. No second trial was started.

## Every change made

1. Changed `ops/factory/apply-install-patches.py` to remove the `@mastra/auth-workos` 1.6.5 code modification. The existing Factory skill-root modification remains because skill loading is outside this step.
2. Changed `ops/factory/install.sh` to stop running the WorkOS cookie regression. Deleted `ops/factory/workos-cookie-identity.check.mjs` and updated `ops/factory/README.md` to describe the remaining skill-root patch.
3. Copied those three changed operational files to `/var/lib/julia-factory/patches/` on OVH and removed the old WorkOS regression there. The Factory application's existing `postinstall` hook still invokes `apply-install-patches.py`, now without an auth patch.
4. Stopped `julia-factory-trial.service` and saved `/etc/julia-factory/factory.env` to root-only `/etc/julia-factory/factory.env.before-platform-auth-20260927` (mode 0600). No credentials were copied into this repository.
5. Ran `npm ci --include=dev` against `/var/lib/julia-factory/app` as `julia-factory`, using the existing lockfile. The postinstall hook changed only the skill roots. Ran `npm run check` and `npm run build`; both passed. The installed and built `@mastra/auth-workos/dist/index.js` hashes are both the original `0e36ef9c0aab8063be3e9cd8c650f83fcf6681cccc476b8680835204ead9c098`.
6. Removed active `WORKOS_*` settings from `/etc/julia-factory/factory.env` so the generated entry selects Factory's default Mastra platform provider. Preserved `MASTRACODE_PUBLIC_URL=https://julia-factory.tail91f394.ts.net`. Restarted `julia-factory-trial.service`; it is active.
7. Added this record and updated `julia-next-handoff-2026-09-27-mastra-setup.md`. Posted the result to JUL-183.

## Result and stop point

An unauthenticated request to `https://julia-factory.tail91f394.ts.net/auth/login` returned HTTP 302 to `https://platform.mastra.ai/v1/auth/login` with callback `https://julia-factory.tail91f394.ts.net/auth/callback`. Following the redirect returned HTTP 400: `redirect_uri host not allowed`. Todd could not sign in through this provider at this address, so no new work session was opened. No second trial was started.

Mastra says the generated server uses [platform sign-in by default](https://factory.mastra.ai/configure/auth), `MASTRACODE_PUBLIC_URL` sets the [browser-facing callback origin](https://factory.mastra.ai/reference/environment-variables), and a [self-hosted deployment](https://factory.mastra.ai/deployment) needs a public HTTPS endpoint. Our HTTPS origin already satisfies the published public-URL setup; it does not make the platform accept the hostname. A [Mastra issue with the same error](https://github.com/mastra-ai/mastra/issues/20761) describes platform auth rejecting a self-hosted origin. The Factory docs document [deployment to Mastra platform](https://factory.mastra.ai/deployment) as the route that reports a platform Factory URL. They do not document a self-service way to register this Tailscale hostname for platform login. This last absence is a documentation finding, not proof of every possible private Mastra support option.

Mastra [lists metered platform deployment](https://mastra.ai/pricing): Starter includes 24 CPU hours per month, then $0.35 per hour, and a persistent 24/7 server is $100 per project. No platform project was deployed, no payment was made, and no paid resource was started. Any platform move needs a cost decision and Todd's account access first. The current self-hosted default platform sign-in remains blocked at the public address. The prior WorkOS secrets are retained only in the root-only backup; the auth package patch is gone.

## Approved exception #1: WorkOS cookie identity fix

Date: 2026-09-27. Todd approved restoring only the version-pinned WorkOS sign-in fix from [mastra-ai/mastra#25252](https://github.com/mastra-ai/mastra/issues/25252). Its cookie authentication path must infer the organization from exactly one active membership when the cookie omits `organizationId`, while retaining an explicitly selected organization. This is needed because default Mastra platform sign-in rejects our public host, and [Mastra's Factory documentation](https://factory.mastra.ai/deployment) does not describe registering a self-hosted hostname with platform login. An earlier reference to [mastra-ai/mastra#24542](https://github.com/mastra-ai/mastra/issues/24542) being open was checked against GitHub's live API: that issue is **closed** and concerns Studio access on Mastra Platform, so it is not evidence for this host restriction. The observed HTTP 400 and [the Mastra issue describing the same error](https://github.com/mastra-ai/mastra/issues/20761) are the host-rejection evidence.

Removal condition: **take exception #1 out when #25252 ships in a Mastra release**, after verifying that release fixes this path, then reinstall and build from the lockfile.

### Changes and verification

1. Replaced `ops/factory/apply-install-patches.py` with only the pinned WorkOS cookie fix. It refuses other package versions or unexpected original bytes. Removed the prior Factory `workspace.js` skill-root patch from the script and updated `ops/factory/README.md`. The script is still called by the app's existing `postinstall` hook; no other Mastra package patch is applied.
2. Copied the revised patch and README to `/var/lib/julia-factory/patches/` on OVH. Stopped Factory, saved the then-current protected environment as `/etc/julia-factory/factory.env.before-approved-workos-20260927`, and restored the prior root-only WorkOS environment backup. Four `WORKOS_*` entries were restored; no secret values were printed or copied into this repository.
3. Ran `npm ci --include=dev`, `npm run check`, and `npm run build` as `julia-factory` from the existing lockfile. All passed. Reapplied the patch after build because Mastra regenerates `.mastra/output`.
4. Verified SHA-256 for both app and built `@mastra/auth-workos/dist/index.js`: `dcefe1c1948970e65bc9f943ef43c05d0bc3de11da06cbde887a98f94d6c7761` (patched). Verified both app and built `@mastra/factory/dist/workspace.js`: original `05dfd4656c6c58385fe2b03b561ef9bb432a9a5679658ef011eb36d5f7a6d5f2` (unmodified).
5. Restarted `julia-factory-trial.service`. The public `/auth/login` now returns HTTP 302 to `api.workos.com/user_management/authorize` with `https://julia-factory.tail91f394.ts.net/auth/callback`; following it reaches the WorkOS sign-in page with HTTP 200. Todd's browser sign-in and two fresh work-session checks are pending; a reachable sign-in page alone is not proof of successful sign-in.
6. In Chrome, verified the existing WorkOS session displayed Todd's Factory account and organization. Logged out that prior browser session to make the requested sign-in check fresh, then opened the public `/auth/login` page and left its WorkOS sign-in tab for Todd. WorkOS's logout redirect briefly showed `app-homepage-url-not-found`; opening `/auth/login` reached the normal sign-in page. This is an observed logout configuration issue, not a sign-in result. No new work session has been started yet.
7. Restored the standalone `ops/factory/workos-cookie-identity.check.mjs` regression and its before/after-build calls in `ops/factory/install.sh`, copied them to the protected deployment patch directory, and ran it against both installed package copies. Both passed for one active membership, explicit organization precedence, and no membership. This changed no additional Mastra package code.
8. Updated this change list and `julia-next-handoff-2026-09-27-mastra-setup.md`, and posted the interim result on JUL-183 (comment `00fa107d-c3d0-438d-9829-c9282dad3c51`). Final sign-in and session evidence remains pending.

### Final sign-in and session proof

9. Todd replied `done` after a fresh WorkOS sign-in in Chrome. Claimed his Factory tab and verified the authenticated sidebar showed **Todd Wyder** and the **New user session** control. This is browser evidence after the old session was logged out, not reuse of the earlier authenticated page.
10. Created a new **Explore** user session with a read-only setup prompt. [Session `b6043d61-8a6e-44c1-88d0-9f7230353827`](https://julia-factory.tail91f394.ts.net/factories/49b0ea94-d24b-43d7-8ce1-618cb61c5188/user/threads/b6043d61-8a6e-44c1-88d0-9f7230353827) opened, ran a `view` tool against its own sandbox's `package.json`, and answered with the `julia-next` package name and its scripts. Its sandbox was `31bc1e7a-7093-40e3-94e3-98c91f243221`.
11. Created a **second** new Explore user session with a separate read-only prompt. [Session `ab94ab76-4135-4c8b-ac28-a617bee7c6a6`](https://julia-factory.tail91f394.ts.net/factories/49b0ea94-d24b-43d7-8ce1-618cb61c5188/user/threads/ab94ab76-4135-4c8b-ac28-a617bee7c6a6) opened with sandbox `de70380a-e6ab-4d08-9c56-cc68a8c956db`. It ran file lookup tools and correctly reported that the repository has no root `README.md`; the initial read failed because that file is absent, not because of authentication.
12. Ran `git status --short` in both sandbox checkouts as `julia-factory`; both returned empty output. Closed the unused WorkOS sign-in tab and left Todd's second Factory session tab open. No GitHub issue, PR, trial card, code change, or second trial was started by these probes.
13. Updated the handoff and posted the final setup proof to JUL-183 as comment `0bd5215d-57ff-416b-880a-e79ccac31a27`.

**Result:** The requested sign-in and both distinct fresh-session checks passed. The WorkOS package patch remains the single approved Mastra code exception until a release fixes #25252. The preceding pending statements are chronological records of the earlier stop points.

## Stock Factory reset before Todd's second trial — 2026-09-27

Scope: setup cleanup only. No second-trial issue, card, session, PR, or run was created or started. The completed first trial and its GitHub issue/PR remain historical records.

### Changes, in order

1. Inspected the live Factory service, the persisted project and cards, model credential metadata, GitHub connection, installed files, CI runner, and Vercel project. `julia-factory-trial.service` and the runner were active. The project had `auto_run_enabled=false` and `auto_approve_plans=false`. Only one card used `julia-trial`: completed GitHub issue #129, in `done`, revision 11.
2. Stopped Factory. Moved that completed card to the installed `work` board's `done` stage with a guarded database update (revision 12), removing trial-only `candidateSha` and `autoStartCandidate` metadata. No card remains on `julia-trial`. The historical card, its session link, and its stage history remain visible in Done; they do not control future cards.
3. Removed the `createTrialBoard` import, custom `boards` option, and `sandboxStart: 'eager'` option from the live Factory entry. Deleted `src/mastra/trial/`, the protected `/var/lib/julia-factory/evidence/jul183/` directory including its manifest and checker artifacts, the trial reverify/guard directories, and the two `.jul183-*` controller helpers from the live app. Removed the corresponding board, transition check, evidence-sync, and entry-configuration files from `ops/factory/` and `/var/lib/julia-factory/patches/`; removed local `.julia` JUL-183 controller/proof/transition scripts and the issue draft. Historical screenshots and ordinary session records were left intact.
4. Simplified `ops/factory/install.sh` and the deployed wrapper so a clean install runs only the approved WorkOS patch/regression, TypeScript check, and build. Updated the Factory README. Ran the wrapper as `julia-factory` against the existing lockfile: `npm ci`, both WorkOS regressions, `npm run check`, and `npm run build` all passed. Installed and built WorkOS files both hash to `dcefe1c1948970e65bc9f943ef43c05d0bc3de11da06cbde887a98f94d6c7761`. Restarted Factory; the service is active. A grep of the live entry and built entry found no `julia-trial`, `trial-board`, or `sandboxStart` reference.
5. Replaced the live GitHub `main` CI workflow's JUL-183 runner label and PR filter with `runs-on: ubuntu-latest` in commit `f5afc32c547dbb9b9396ea68df43c9c9e31edf8e`; made the corresponding local workflow edit. Stopped and uninstalled the dedicated runner service, deleted GitHub runner ID 21, and removed its service drop-in, dedicated `/var/lib/julia-trial-ci` directory, and `julia-trial-ci` account. Removed `ops/factory/ci-runner.md`. GitHub now lists zero repository runners. The new hosted CI job [failed before any steps](https://github.com/toddwyder/julia-next/actions/runs/36359877640) with GitHub's billing/spending-limit annotation. This blocks a CI-verified merge until Todd resolves billing or approves a runner exception; it does not block stock Factory sign-in, intake, investigation, model use, or GitHub connection.
6. In Vercel's Deployment Protection settings, removed the single unprotected preview-domain exception for `julia-next-hk9swmf1p-toddwyder-2186s-projects.vercel.app`. The dashboard confirmed protection restored. An anonymous request now returns HTTP 302 to Vercel sign-in. The project's normal Standard Protection remains enabled. A future anonymous rehearsal preview will need its own access decision; stock Factory works without this exception.
7. Verified live public Factory `/auth/login` returns HTTP 302 to WorkOS with the intended HTTPS callback, and the signed-in Chrome Factory UI shows only stock **Work** and **Review** boards. Work shows Auto-start runs off, issue #1 in Intake with an **Investigate** button, and the historical issue #129 in Done. The project remains configured with `openai/gpt-6-sol`; organization credential metadata shows `openai-codex` OAuth and DeepSeek API key, and the existing GitHub project connection remains. No model or GitHub credentials were printed or copied.
8. Updated this change list and `julia-next-handoff-2026-09-27-mastra-setup.md`. Posted the plain-English reset report to [JUL-183](https://linear.app/julia-next/issue/JUL-183/mastra-trial-one-tiny-card-all-the-way-through-factory) as comment `e57f6dff-bf13-4b33-a3ff-08c4d61c8358`.

### Remaining configuration and exceptions for Todd

- **Approved exception #1 — WorkOS package cookie fix:** the sole installed Mastra package code change, plus its guarded postinstall hook and regression. Required for sign-in on this self-hosted HTTPS address. Remove after a verified Mastra release fixes [#25252](https://github.com/mastra-ai/mastra/issues/25252).
- **Proposed exception — self-managed access configuration:** WorkOS provider settings, the public HTTPS origin, local sandbox, PostgreSQL storage, and the direct GitHub App connection are supported deployment settings for this self-hosted Factory. Factory here needs the sign-in and GitHub portions; no trial-specific board or dispatch code remains. The service account's normal Git author identity lets stock work sessions commit. Todd should approve retaining this deployment configuration for the second trial.
- **Proposed exception — model connections and choices:** the existing organization OpenAI Codex OAuth connection, direct DeepSeek API-key connection, GPT-6 Sol default, and observer/reflector selections provide model access. A stock new session and the two earlier read-only checks worked with the OpenAI connection. `forked: true` was a supported option used only for parallel reviews; it is not installed code or a prerequisite for stock Factory. DeepSeek is needed only if the second trial calls for that independent reviewer. Todd should approve retaining these connections/settings.
- **GitHub App permission review pending:** the first trial added Workflows read/write to the Factory App so it could publish its CI workflow repair. That extra permission is not needed for ordinary stock Factory GitHub access. GitHub requires Todd's passkey recheck before its app settings can be inspected or reduced; do not claim it was removed. If it remains, treat it as a proposed exception until Todd approves retention or completes the permission reduction.

### Todd's start action

After Todd creates the second trial's GitHub issue himself and Factory imports it, he opens the [Factory Work board](https://julia-factory.tail91f394.ts.net/factories/49b0ea94-d24b-43d7-8ce1-618cb61c5188/work), finds the new card in **Intake**, and taps **Investigate** once. Auto-start runs is off; no agent will trigger it. The existing issue #1 card already demonstrates the exact Intake/Investigate control. No agent is to touch Factory once Todd starts the second trial.

## Observability switched on and memory models moved (JUL-184) — 2026-09-28

Todd instructed the change and restart in chat. Only Mastra's documented configuration was used. No Mastra package code changed beyond approved exception #1.

1. **Memory models.** Observer and reflector are set to `deepseek/deepseek-flash` in both the personal and Factory-wide memory settings, through Factory's own `PUT /web/config/om/:role/model`. Read back from `GET /web/config/om` (previously `openai/gpt-6-sol`). **Auto-approve plans** is on, and Auto-start runs stays off (project settings read back).
2. **Backups** (suffix `.before-observability-20260928`): `app/src/mastra/index.ts`, `app/package.json`, `app/package-lock.json`, `/var/lib/julia-factory/.local/share/mastracode/settings.json`, and `/etc/julia-factory/factory.env` (root-only).
3. **Tracing switch.** `settings.json` now has `observability.localTracing: true`. Factory's code-sdk uses this switch to put a DuckDB observability area into the storage it passes to `new Mastra`. DuckDB is the metrics-capable store that [Mastra's observability docs](https://mastra.ai/docs/observability/overview) require.
4. **Entry file.** `src/mastra/index.ts` now imports `Observability`, `MastraStorageExporter` and `SensitiveDataFilter` from `@mastra/observability`, and passes `observability: new Observability({ configs: { default: { serviceName: 'julia-factory', exporters: [new MastraStorageExporter()], spanOutputProcessors: [new SensitiveDataFilter()] } } })` to `new Mastra`, as in the docs example.
5. **Packages.** `package.json` now declares `@mastra/observability` 1.18.1 and `@mastra/duckdb` 1.11.1. These versions were already installed as transitive dependencies. `npm install --package-lock-only` changed the lock file's root entry only: the two dependencies plus `hasInstallScript`.
6. **Memory fallback.** `/etc/julia-factory/factory.env` now sets `DEFAULT_OM_MODEL_ID=deepseek/deepseek-flash` (read by `@mastra/code-sdk` `dist/constants.js:12`). This replaces the uncredentialed `google/gemini-3.5-flash` default.
7. **Install and restart.** Stopped the service, then ran `patches/install.sh` as `julia-factory` (exit 0; log at `/var/lib/julia-factory/install-observability-20260928.log`), then started the service. The WorkOS regression passed, and both package copies hash `dcefe1c1948970e6…`. The service is active. `observability.duckdb` and its `.wal` were created in the mastracode data folder. Public `/auth/login` returns 302 to WorkOS.

Not yet verified: that a real session's spans and cost metrics land in DuckDB, which will be checked on the first real card, and whether Studio can be opened.

Rollback: restore the five backups, run `install.sh`, and restart `julia-factory-trial.service`.

## Repository-sourced Factory setup (issue #136) — 2026-09-28

The server's deployed `package.json`, `package-lock.json`, `tsconfig.json`, and
`src/mastra/index.ts` were captured in `ops/factory/app/`. The entry and TypeScript
config are byte-identical to the live source; the manifest and lock differ only
by removal of the machine-specific `postinstall` hook and its root lockfile flag.
The repository installer now copies these four files to the target and invokes
only the approved in-repo WorkOS patch after `npm ci` and after Mastra's build.
No `.env`, credentials, databases, generated public UI, `node_modules`, or
workspace state were copied. Mastra generates the Factory UI during build.

A fresh isolated install at `/tmp/julia-factory-stage.55mT7x` completed `npm ci`,
WorkOS cookie regression, `tsc --noEmit`, Factory build, built-package patch and
second cookie regression. Both package copies had the approved patched hash
`dcefe1c1948970e65bc9f943ef43c05d0bc3de11da06cbde887a98f94d6c7761`.

Later on 2026-09-28, Todd authorized an operator to install PR #142's repository
copy at commit `8e97c95` on the live service. The operator reported that the
four copied source files matched the live app except for the intended removal
of the server-specific `postinstall` hook and its lockfile flag. They backed
up `/var/lib/julia-factory/patches` to
`/var/lib/julia-factory/patches.before-pr142-20260928` and the four app files
with suffix `.before-pr142-20260928`; deployed `ops/factory` to
`/var/lib/julia-factory/patches`; stopped the service and ran `install.sh`.
The install exited 0 with the WorkOS regression, typecheck and build passing;
its log is `/var/lib/julia-factory/install-pr142-20260928.log`. After the
restart, the service was active, both copies had the approved WorkOS patched
hash, `/auth/login` returned 302 to the WorkOS authorize URL, the DuckDB trace
store had been written after restart, and the journal had no errors. These are
operator-reported observations, not independent browser verification.

Todd's personal sign-in, a fresh session's trace/metric contents, and Studio
visibility were not verified by that report; Studio and trace retention are
tracked by issue #140. The trace store was 1.7 GB after approximately 10 hours,
with 30 GB of disk space free. The backups above provide the source/patch
rollback copies; no rollback was performed because the restarted service was
healthy. Source: Todd's 2026-09-28 comment on PR #142.

## 2026-09-28: #146 bubblewrap staging — not deployed

In the disposable Factory work checkout, `julia-factory` could execute `bwrap`
(version 0.9.0). The repository-sourced local sandbox was changed to request
Mastra's native `isolation: 'bwrap'` with its default offline policy; no installed
service files, environment variables, or live service were changed. A throwaway
workspace probe through the public `LocalSandbox.executeCommand` API produced:

| Check | Result |
|---|---|
| Isolated command (`printf isolated`) | Exit 0 |
| Outside-workspace readable canary (`test -r`) | Exit 1, while the service user could read it outside the sandbox |
| Installed application source readability (`test -r`) | Exit 1; host service user can read it outside the sandbox |
| `/etc/julia-factory/factory.env` readability (`test -r`) | Exit 1; that path was not present in this checkout's host view, so this is not a server-secret proof |
| `git ls-remote https://github.com/toddwyder/julia-next.git HEAD` | Exit 128 inside the offline sandbox; the same command succeeded outside it |
| Backend metadata | `bwrap` |
| Backend missing from `PATH` | Construction threw; no host fallback |

This is **not** a live bound Factory session or a pre-merge server proof. No
credentials or secret contents were read or printed. Factory's pinned package
scopes Git credentials to individual processes, but its materialization clones
inside the sandbox and needs outbound Git network access. Mastra core 1.71.0
implements `nativeSandbox.allowNetwork: true` by omitting `--unshare-net`, which
restores general host networking rather than Git-only egress. With the safe
network-off policy, the required fetch/commit/push proof cannot succeed. Enabling
unrestricted egress would weaken the issue's intended boundary; no custom
network filter, paid provider, Mastra patch, or silent fallback was added. Todd
chose to keep restricted networking on 2026-09-28: do not deploy/merge this
staged change or open a PR. Plan a separately approved restricted-egress design
before resuming. After that decision, the actual Factory server still needs operator installation proof,
key/database denial, disposable Git fetch/commit/push, and (after #144) retired
Orca unreachability; a real card must traverse planning and review. None of those
server/end-to-end checks is claimed complete here.

## 2026-09-28: #146 decision update — network-enabled bubblewrap in repository, server proof pending

Todd's later decision supersedes the restricted-network stop in the earlier staging entry: general internet access for isolated Factory agent commands is approved. The saved `.artifacts/plans/issue-146.md` was revised in place. The repository configuration now sets `isolation: 'bwrap', nativeSandbox: { allowNetwork: true }`; no custom network filter, new host bind, Mastra patch or paid provider was added. The earlier offline results remain historical, not a description of the current configuration. The retired Orca reachability check moved to #144 and is not a #146 release gate.

A new disposable-workspace test first failed with network-off (HTTP request to a temporary localhost server exited 7), then passed with network enabled while the outside readable canary remained inaccessible. This test does not demonstrate a live bound Factory session, installed-service package versions, protected-location canaries, or Factory-managed Git credentials. Before merge, verify on the installed server that every protected canary exists outside the sandbox before testing denial inside, test fail-closed execution, and complete a disposable fetch/commit/push via Factory's integration. Record the actual commands, exit statuses, deployment and rollback steps, network scope, and limitations in this log and the PR without exposing secrets.

Non-invasive host check from the `julia-factory` checkout (not an installed-session proof): `command -v bwrap` returned `/usr/bin/bwrap`; `bwrap --version` returned 0.9.0; the installed lockfile reports Factory 0.17.2 and Core 1.71.0; `systemctl is-active julia-factory-trial.service` returned `active` with `WorkingDirectory=/var/lib/julia-factory/app`. The readable installed `src/mastra/index.ts` is still the original version, not the new local-sandbox delegate; the running service has **not** loaded this change. `/etc/julia-factory` is root-only and its `factory.env` is not readable by this checkout user; that fact is **not** evidence that agent commands in the live service cannot read it. `sudo -n true` failed (exit 1), so this session cannot perform the required operator-managed service backup/restart. No service files, secrets, credentials, or runtime process were changed. The installed Factory command path, protected-location canaries, and disposable Git fetch/commit/push remain unverified. Any PR from this checkout must remain unmerged until the operator stages the install with rollback and records those actual Factory-session results.

## 2026-09-28: PR #147 installed on the Factory server

Todd authorized installing open PR #147 (`factory/issue-146`, head `03783eb00316fb0f4c079f1238e68dedaf502f97`) without merging or using Factory's screens. The server's existing #146 checkout was clean at that exact commit. Before the change, the service was active with Factory 0.17.2 and Core 1.71.0.

- Stopped `julia-factory-trial.service` at 22:54 UTC. Archived `/var/lib/julia-factory/app` and `/var/lib/julia-factory/patches` to `/var/lib/julia-factory/app-and-patches-before-pr147-20260928T225424Z.tar.zst` (885,911,652 bytes; SHA-256 `8431c92874027bc2c0067561b87b9300499172550075d57a271724e862671f5b`). `zstd -t` passed. The backup wrapper returned exit 1 only because its final `true` had a Windows CRLF; archive creation and verification had completed.
- Copied only `ops/factory/install.sh` and its seven declared inputs from that clean commit to `/var/lib/julia-factory/patches/`; every `cmp` passed. The new `local-sandbox.ts` SHA-256 was `da326fdda378aacbfc778e78ecdaa7ff00d5f28732c313180accb8e03bfb13cb`; `index.ts` was `3a5ad4f2327db94e3a20113342c0daea8c23c8a8a32e126c02b48b17abe9be51`.
- Ran `sudo -u julia-factory -H bash /var/lib/julia-factory/patches/install.sh /var/lib/julia-factory/app`. It exited 0: `npm ci`, the existing WorkOS patch/regression in app and output, `npm run check`, and `npm run build` passed. No Mastra package patch was added.
- Started `julia-factory-trial.service` at 22:58:13 UTC. It returned `active` with MainPID `2162614`. Installed source byte-matches the staged PR inputs; `.mastra/output/mastra.mjs` contains `allowNetwork: true` and the `isolation=bwrap network=on` log statement. The service setting is `FACTORY_SANDBOX_PROVIDER=local`. An unauthenticated local HTTP probe returned 401. No Factory screen was pressed and nothing was merged.

The restarted service is running the new built configuration. Actual bound-session isolation, protected-location canaries, fail-closed execution, and Factory-managed Git fetch/commit/push remain unverified pre-merge checks. No secret values were read or printed.

## 2026-09-28: PR #147 protected-path inventory and host canaries

Recorded on [PR #147](https://github.com/toddwyder/julia-next/pull/147#issuecomment-5880430929).

Operator host-side inventory for PR #147 (no sandbox command was run; no secret value was printed):

| Protected location | Path | Owner | Mode |
|---|---|---|---|
| GitHub App private key and credential environment source | `/etc/julia-factory/factory.env` | `root:root` | `0600` |
| Running service environment (virtual file) | `/proc/2162614/environ` | `julia-factory:julia-factory` | `0400` |
| PostgreSQL data directory | `/var/lib/postgresql/16/main` | `postgres:postgres` | `0700` |
| PostgreSQL file existence witness | `/var/lib/postgresql/16/main/PG_VERSION` | `postgres:postgres` | `0600` |
| Factory local database | `/var/lib/julia-factory/.local/share/mastracode/observability.duckdb` | `julia-factory:julia-factory` | `0600` |
| Factory service home | `/var/lib/julia-factory` | `julia-factory:julia-factory` | `0750` |
| Home Git config | `/var/lib/julia-factory/.gitconfig` | `julia-factory:julia-factory` | `0664` |
| Home application config | `/var/lib/julia-factory/.config/varlock/config.json` | `julia-factory:julia-factory` | `0600` |
| Factory settings | `/var/lib/julia-factory/.local/share/mastracode/settings.json` | `julia-factory:julia-factory` | `0600` |

The service environment contains nonempty `GITHUB_APP_PRIVATE_KEY`, `DATABASE_URL`, and `FACTORY_CREDENTIAL_ENCRYPTION_KEY` variables; only presence was checked. No standalone GitHub App key file was found in the inspected protected directories. The process environment is a virtual file, so its physical source directory `/etc/julia-factory` received a canary.

Harmless canaries created and independently stat-checked outside the sandbox (each holds an undisclosed random word):

| Canary path | Owner | Mode |
|---|---|---|
| `/etc/julia-factory/.factory-bwrap-canary-pr147-20260928` | `root:root` | `0600` |
| `/var/lib/postgresql/16/main/.factory-bwrap-canary-pr147-20260928` | `postgres:postgres` | `0600` |
| `/var/lib/julia-factory/.factory-bwrap-canary-pr147-20260928` | `julia-factory:julia-factory` | `0600` |
| `/var/lib/julia-factory/.config/.factory-bwrap-canary-pr147-20260928` | `julia-factory:julia-factory` | `0600` |
| `/var/lib/julia-factory/.local/share/mastracode/.factory-bwrap-canary-pr147-20260928` | `julia-factory:julia-factory` | `0600` |

The three `julia-factory`-owned canaries are readable by that account on the host. The root/PostgreSQL canaries establish existence but their parent directories already deny that account under normal host permissions. This inventory prepares the live Factory-command test; it does not claim sandbox denial. No merge or Factory screen action was performed.

## 2026-09-29: PR #147 installed-session proof and CI follow-up

In the installed Factory command session, the operator-confirmed protected paths and all five canaries were inaccessible: each `test -r` failed, and one-byte reads of the five canaries failed without printing contents. The service home directory itself is visible as the workspace ancestor, which Todd accepted; none of its inventoried private files was readable. The session environment contained no `GITHUB_APP_*`, `WORKOS_*`, `DATABASE_URL`, or `FACTORY_*` names, and the running service PID was absent in the command namespace. Individual results and host-existence qualifications are on PR #147 comments 5881032612 and 5881281690. Todd checked #146's protected-file item. The missing-bwrap test (`PATH` without bwrap) passed again, 1/1, and Todd accepted it as sufficient fail-closed proof without deliberately breaking the live service (issue comment 5881399372).

An isolated installed-session disposable branch `factory-proof-146-20260928230825-2` completed fetch, commit, push, matching remote read-back, and verified remote deletion. It used this command session's `GH_TOKEN`, not a directly inspected Factory installation token; no credential value was printed. Todd separately accepted PR #147's own Factory review session preparing its checkout in the installed sandbox at 17:28 PT September 28 as proof that Factory's normal repository-materialization credential route works. General internet access through `nativeSandbox.allowNetwork: true` is enabled and accepted; this is not Git-only egress. Issue #146 Git item checked and decision recorded in comment 5882005208.

GitHub Actions run 36497019721 installed bubblewrap 0.9.0 on `ubuntu-latest`, but both permitted sandbox commands exited 1 before reaching their expected output; the missing-bwrap test passed. The CI job now requests GitHub's `ubuntu-22.04` VM instead of `ubuntu-latest` while retaining all three behavior tests and the app typecheck. The hosted-runner outcome must be checked before treating this fix as verified. The Factory review's separate Standards and Spec verdict has not been recorded on PR #147; do not merge on this entry alone.

## Factory wait-alert watcher — 2026-09-29 UTC

- Backed up the live app source and install patches to `/var/lib/julia-factory/backups/pre-wait-alerts-20260929.tar.gz` before installing the watcher. Generated `node_modules` and `.mastra/output` were excluded because the normal installer rebuilds them from the pinned lockfile.
- Added the read-only wait watcher and SQL to the normal Factory installer, plus a one-time setup for its PostgreSQL peer role, private ntfy topic, and one-minute systemd timer. The SQL begins `BEGIN TRANSACTION READ ONLY`; the `julia-factory` peer role has SELECT only on the listed Factory tables and a read-only default. The watcher writes only its separate SQLite delivery ledger, never Factory records.
- Ran the normal installer as `julia-factory` on `/var/lib/julia-factory/app`. `npm ci`, TypeScript check, Mastra build, and the pinned WorkOS regression passed. The timer was enabled and active at 01:07:46 UTC. Its delivery gate remained closed until Todd subscribed to ntfy on phone and Windows. The random topic is stored in root-owned `/etc/julia-factory-wait-alerts/config.json` (group `julia-factory`, mode `0640`), not in the repository or a public issue.
- A dry run as the service user found eight live waits: six proposed automation decisions, one supervisor finding, and #139's Triage approval. #139's link targets its exact Work card. Local tests passed for one delivery across repeated timer runs, deterministic notification identity, and the card-specific click link.
- Restarted `julia-factory-trial.service`; it became active again at 01:08:45 UTC while the watcher timer stayed active and enabled. Todd then confirmed both subscriptions. Opened the delivery gate and started the watcher. At 01:21:29 UTC it published and recorded one alert for each of the eight current waits, including #139. Mastra's built-in-alert request is [mastra-ai/mastra#25378](https://github.com/mastra-ai/mastra/issues/25378); the local tracking issue is [#148](https://github.com/toddwyder/julia-next/issues/148).
- Todd confirmed the #139 alert reached both phone and Windows desktop and opened the correct Triage card. A second watcher run produced no further deliveries; the ledger remained at eight rows.
- Re-ran the normal PR #147-based installer with the watcher copy step. Dependency installation, WorkOS regression, TypeScript check, and Mastra build passed. The installed watcher byte-matches the staged source (SHA-256 `5f192141b5235114a905b0799ad0c758065d787e7011f791aaa709a56f2792b2`). Restarted `julia-factory-trial.service`; Factory and the watcher timer were both active.
- Rebooted the server. The boot ID changed from `a30a0a8c-d0a1-4ecd-af13-7ca07e98a782` to `c46ce9a4-4713-4383-91f7-efcaa1407283`. At 01:29:16 UTC Factory and the enabled watcher timer were active, the read-only snapshot still found eight waits, and a forced watcher run left the delivery ledger at eight rows with zero new deliveries. This proves restart and reboot persistence without duplicate alerts.
- Pending: observe a new live session question or plan review and confirm exactly one alert within five minutes. Continue checking that non-waits produce no alert.

## 2026-09-29: narrow Factory wait alerts after Todd's noise report

Todd reported 12 alerts in 10 minutes, including duplicate-looking Intake run suggestions. The initial watcher treated each proposed automation decision ID as a separate wait; Factory created multiple such IDs for the same cards. Those suggestions are not waits for Todd. The earlier claim that every delivered alert was actionable was incorrect. Stopped the timer at 01:39:27 UTC and backed up the installed watcher code, SQL, and delivery ledger under `/var/lib/julia-factory/backups/wait-alerts-pre-filter-20260929.*` and `wait-alerts-ledger-pre-filter-20260929.sqlite3`.

The watcher now selects only pending session questions and plans, unresolved supervisor findings, and Triage cards labeled `status: needs approval`. It excludes automation decisions and mentions. Triage and supervisor keys are stable across stage or occurrence changes; the existing ledger is migrated so previously alerted items are not sent again. It commits a one-time attempt before the ntfy request, so a timeout or crash cannot cause a second send. An uncertain or failed send remains marked `attempted` for operator inspection and is not automatically retried. The database role no longer needs SELECT on automation-decision or comment tables. Five focused Python tests passed, and the read-only live snapshot before reinstall listed only the supervisor finding and #139 Triage approval.

**Review order:** The watcher was installed and began sending alerts at 01:21:29 UTC, before Factory reviewed its pull request. PR #149 was opened under Todd's identity at 01:30:48 UTC and closed because its author could not pass the publisher-only gate. The running watcher was deliberately left on while the same change was reopened under the Factory App for review. The live installation is evidence of behavior, not evidence that review preceded deployment. Issue #148 remains open until a new session question or plan review produces exactly one alert within five minutes.

Reinstalled through the normal Factory installer. `npm ci`, WorkOS regression, TypeScript check, and Mastra build passed; the installed watcher matched the staged source SHA-256 `7ef519d0683b7783952823861d1eba705993d31e5403c142a50996fc1aab40f7`. Re-ran the root setup to revoke the unused SELECT grants, restarted Factory, and resumed the watcher timer. The first full timer cycle completed successfully at 01:43:05 UTC with **zero new sends**. Its current alert list contained only #139's Triage approval; the supervisor finding had resolved. The migrated ledger contained the stable #139 and supervisor keys once each. Factory and the watcher timer were both active. The 13 earlier automation proposal rows remain in the historical ledger but are no longer eligible for alerts.

## 2026-09-29: PR #150 Factory review and query regression

PR #149 was closed and the same `factory/issue-148` change reopened as Factory App-authored [PR #150](https://github.com/toddwyder/julia-next/pull/150). The live watcher stayed on. Factory's Review transition required Todd's signed-in approval; after that approval, Factory ran its bound review and [requested changes](https://github.com/toddwyder/julia-next/pull/150#issuecomment-5882726526) at 02:52:50 UTC. CI was green, but the reviewer asked for a query-level regression of new question/plan waits and explicit plan/framework-map artifacts. It also noted the live new-wait alert check remains open.

Added `ops/factory/wait-alerts.sql.test.py`, which runs the actual read-only wait query against temporary PostgreSQL fixture tables. On the Factory server, `sudo -u postgres python3 /var/lib/postgresql/factory-wait-test/wait-alerts.sql.test.py julia_factory_trial` passed: fresh question and plan appear; a completed question, archived plan, and unrelated tool call do not. The fixture session creates only temporary tables and does not modify live Factory records. Added `.artifacts/plans/issue-148.md` as an explicitly retrospective plan record; no advance approval is claimed. The new live phone/Windows delivery check remains open and #148 stays open.

## 2026-09-29: issue #144 graph-era service retirement

The build sandbox could not inventory or change OVH services. An attempted read-only SSH connection to `ubuntu@100.125.239.98` with `-o BatchMode=yes -o ConnectTimeout=6 -i ~/.ssh/ovh_runner_ed25519` failed: the identity file was absent from the sandbox and the host returned `Permission denied (publickey)` (exit 255). Host inventory and retirement were performed instead by an authorized operator over the laptop's Tailscale SSH route, without copying a key or running sudo in Factory. The retired graph watchdog is distinct from the Factory wait-alert timer.

At 2026-09-29 10:20 UTC an authorized operator inspected OVH through the laptop Tailscale SSH route, read-only; no key entered Factory, no credential or environment-file contents were read, and no host service was changed. Before-state: `julia-watchdog.timer` active/enabled (graph-venv watchdog each minute; service inactive between runs); `orca-server.service` active/enabled (`/usr/bin/orca-ide`, `0.0.0.0:6768`); `orca-server-orchestrator.service` active/enabled (`/usr/bin/orca-ide`, `0.0.0.0:6769`, wants `xvfb-orchestrator.service`); `xvfb-orchestrator.service` active/enabled (`/usr/bin/Xvfb :98`, no TCP listener observed); `julia-next-checkout-sync.timer` active/enabled (runs `scripts/checkout-sync.mjs` about every 15 minutes); `julia-ready-queue.timer` and `julia-graph.service` disabled/inactive; `julia-controller.service` not installed/loaded for `orchestrator-svc`; `journey-relay.service` active/enabled (`/opt/orca-runner/journey-relay/relay.mjs`, loopback `127.0.0.1:8943`). Factory and `julia-factory-wait-alerts.timer` are active; preserve both. Checkout-sync and journey-relay still have repository callers, so neither is cleared for removal by this inventory. Repository dependency trace: `scripts/julia-run.mjs` starts `julia-next-checkout-sync.service`; the graph-era `scripts/check-readiness.mjs`, `scripts/orca-cli.mjs`, `scripts/journey-events.mjs` and `scripts/coordinator-events.mjs` use the relay at `127.0.0.1:8943`, while `.github/workflows/ci.yml` still checks its unit and loopback binding. Retire those callers and update their checks before decommissioning either service.

At approximately 2026-09-29 10:41 UTC, the authorized operator confirmed the watchdog timer, both Orca servers, and the Orca-only Xvfb companion were active/enabled before retirement; the watchdog service ran when triggered by its timer. The Orca orchestrator wanted the Xvfb companion; Factory had no systemd dependency on these units. Exact definitions of `julia-watchdog.timer`, `julia-watchdog.service`, `orca-server.service`, `orca-server-orchestrator.service`, and `xvfb-orchestrator.service`, along with the watchdog drop-in, were backed up under `/var/backups/julia-issue-144-20260929T1025Z/`. The operator stopped and disabled the watchdog timer, both Orca servers and Xvfb; stopped the watchdog service; removed only those five unit files and the watchdog drop-in; and ran `systemctl daemon-reload`. Afterward all five reported `LoadState=not-found` and `ActiveState=inactive`, and no process listened on former Orca ports `6768` or `6769`.

The operator verified `julia-factory-trial.service`, `julia-factory-wait-alerts.timer`, `julia-next-checkout-sync.timer`, and `journey-relay.service` remained active. Factory still listened on loopback port `4111` and the relay on loopback port `8943`. Checkout sync and journey relay remain intentionally in place pending their caller and CI cleanup. No CI configuration or CI service was changed during host retirement; CI was not rerun as part of that operation. No private key or environment-file contents were copied or disclosed. These before/after results were reported by the operator, not measured from the Factory sandbox.

The follow-up repository change at PR #153 head `9d5005731977672edb7b99d3f168d5f33eab77d8` removes the checkout-sync script and test, the journey-relay unit/code and its client/event scripts, the graph launcher's checkout-sync trigger, the graph readiness relay probe, and the relay-specific CI guards. The service-dropbox isolation explanation remains without relying on a retired relay file. Local Node tests (959 passed, 7 skipped, 0 failed), Factory type check, framework lint, and application build passed.

An authorized operator reported the remaining host cleanup on 2026-09-29 UTC in PR #153 comment 5889931273. Before: `julia-next-checkout-sync.timer` active/enabled, its service installed and inactive between runs; `journey-relay.service` active/enabled, listening at `127.0.0.1:8943`; a dedicated `/etc/sudoers.d/orchestrator-svc-checkout-sync` grant allowed only starting checkout-sync. No other systemd service depended on either service. Factory and its wait-alert timer were active/enabled, with Factory listening at `127.0.0.1:4111`. The operator inspected and backed up the exact three installed unit files and dedicated sudoers file under root-only `/var/backups/julia-issue-144-remaining-20260929T1204Z/` (mode 0700), and verified all four backup filenames. They stopped/disabled only the checkout-sync timer and relay, stopped the checkout-sync service, removed only those three units and the dedicated grant, and reloaded systemd. `visudo -c` passed on the remaining sudoers files. After: all three units reported `LoadState=not-found` and `ActiveState=inactive`; the grant was absent; nothing listened on port 8943. `julia-factory-trial.service` and `julia-factory-wait-alerts.timer` remained loaded, active, and enabled, and Factory continued listening at `127.0.0.1:4111`. At that head CI, both Publisher-only PR checks, and Vercel preview were reported successful. These are operator-reported results, not host measurements from Factory. No SSH key, sudoers contents, environment-file contents, or credentials entered the sandbox or the evidence comment.
# 2026-09-29: private wait-alert origin, before PR review

The laptop operator diagnosed the public ntfy.sh failure from the Factory host.
A single diagnostic publish to an unsubscribed random topic returned HTTP 429
with ntfy code 42908 (daily message quota). The watcher journal showed 15
accepted publishes that day; no other installed host service referencing
ntfy.sh was found. ntfy.sh documents a 250-message daily visitor limit and
per-visitor IP accounting. The precise other consumer of this server's quota
is unknown; the public free route cannot reserve capacity for these alerts.

Before this change was reviewed, the operator installed ntfy 2.28.0 from its
official Ubuntu repository on the live host and configured a loopback listener
on port 8085, a persistent cache/auth/Web Push store, anonymous read access
only for the existing random topic, and a dedicated token for local publishing.
Tailscale Funnel exposes the new HTTPS origin on port 8443 while preserving
Factory on port 443. A public GET returned 200, unauthorized public publish
returned 403, and an authenticated local noncached diagnostic publish returned
200. The installer was rerun successfully without replacing keys or token.
No watcher code or service gate has been switched yet, and neither device has
subscribed to the new origin. Those checks are origin plumbing evidence only;
they are not a natural Factory wait or two-device delivery proof.

# 2026-09-29: reviewed step 1 host install

The operator verified a root-only compressed backup of the prior Factory app,
watcher unit, ntfy configuration, and watcher config under
`/var/backups/julia-step1-20260929/` before changing the live install. They
stopped the old watcher timer and Factory service, copied the reviewed PR #159
head `602193d82f65e52870d703924a9a19687fd9e267` into the Factory patch
source, and ran the normal installer as `julia-factory`. `npm ci`, the WorkOS
cookie regression, TypeScript check, Mastra build, and the copied-output
regression passed. The root ntfy setup script was installed under
`/usr/local/sbin` and run there. It moved the auth and Web Push databases to
`/var/lib/ntfy` using SQLite backup while ntfy was stopped, then restarted
ntfy. The watcher unit and timer were installed with the new
`subscribed-self-hosted` gate. Factory, ntfy, and the timer became active;
the watcher service remained inactive with `ConditionResult=no`, as intended
until both devices subscribe. The watcher dry run found zero current waits.

The existing topic, publish token, and Web Push keys were preserved. The
private ntfy HTTPS origin returned 200; anonymous publishing to an unrelated
topic returned 403; an authenticated noncached local diagnostic publish
returned 200. These are transport checks, not device delivery acceptance.
After the new GitHub rules were live, the operator removed the ten recreated
machine cards using Factory's `WorkItemsStorage.delete` operation. Four done
Julia history cards remained. A future GitHub poll and the next natural Julia
wait still need observation before #148 closes.

# 2026-10-03: Centralize Factory builder, reviewer, cheap and fallback model settings (#206)

Part of #185. Configured the four model jobs using Factory's stock settings mechanisms and the Cross-maker reviewer environment, deleting the custom model copier (`factory-model-sync.ts`). Changing a model afterwards is a settings change with zero code rebuild.

## Stock mechanisms per job: where each is set and how to change it

| Job | Stock mechanism & setting location | Current / starting value | How to change it | Consuming components |
|---|---|---|---|---|
| **Builder** | Factory project model: `factory_projects.default_model_id` in PostgreSQL storage, naming a registered custom provider | `command-code/deepseek/deepseek-v4-pro` | Update project model in Factory UI or via SQL: `UPDATE factory_projects SET default_model_id = '<new-model>' WHERE name = 'julia-next';` (no code rebuild or restart required) | Factory work sessions, planning, coding |
| **Command Code route** | Factory custom-providers store: `custom_providers` table in PostgreSQL | Provider ID `command-code`, Base URL `https://api.commandcode.ai/provider/v1`, API key from environment / credential store, models: `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`, `moonshotai/Kimi-K2.7-Code` | Update provider or models in Factory UI or `custom_providers` table. Available to every organisation without restarting Factory. | Factory builder execution, routing requests to Command Code |
| **Cheap model** | Factory memory-model setting: `memory_settings` table (and `DEFAULT_OM_MODEL_ID` in `/etc/julia-factory/factory.env`) | `deepseek/deepseek-v4-flash` | Factory API `PUT /web/config/om/:role/model` or update `memory_settings` table / `DEFAULT_OM_MODEL_ID` in `factory.env` | Observational memory across Factory sessions, per-card retro (#187), Monday cost note rework grouping (#196), e2e steps (#197) |
| **Fallback model** | `@mastra/code-sdk` pack fallbacks: `settings.models.packFallbacks` in `/var/lib/julia-factory/.local/share/mastracode/settings.json` (and `JULIA_FALLBACK_MODEL` in `/etc/julia-factory/factory.env`) | `deepseek/deepseek-v4-pro` (direct key) | Update `settings.models.packFallbacks` in `settings.json` or `JULIA_FALLBACK_MODEL` in `factory.env` | Quota fallback (#207) when Command Code quota is exhausted |
| **Reviewer** | Reviewer environment setting: `JULIA_REVIEWER_MODELS` in `/etc/julia-factory/factory.env` | `moonshotai/Kimi-K2.7-Code` | Update `JULIA_REVIEWER_MODELS` in `/etc/julia-factory/factory.env` and restart service (`systemctl restart julia-factory-trial.service`) | Cross-maker reviewer agents (`codeReviewAgent`, `workflowReviewAgent`) and workflows (`prReviewWorkflow`, `crossMakerReviewWorkflow`) |

## Changes made

1. **Deleted custom copier (`factory-model-sync.ts`):**
   Removed `ops/factory/app/src/mastra/factory-model-sync.ts`, its startup hook in `index.ts`, and manifest entries in `install.sh`. No custom code copies model IDs into Factory storage.
2. **Reviewer reads builder directly from Factory project setting:**
   The cross-maker reviewer check dynamically reads `default_model_id` from Factory project storage via `getFactoryBuilderModel(storage)`. `modelMaker()` strips gateway prefixes (`command-code/`, `openrouter/`, etc.) and determines the canonical maker (e.g. DeepSeek vs Moonshot/Kimi). Same-maker pairs are rejected; different-maker pairs pass regardless of route.
3. **Restored code-review agent GitHub tools and memory:**
   `codeReviewAgent` keeps all GitHub tools (`parseGitHubPRUrl`, `getPullRequest`, `getPullRequestDiff`, `getPullRequestFiles`, `getFileContent`) and observational memory, backed by verified tests.
4. **Secret-safe validation and error handling:**
   `SettingValidationError` explicitly suppresses `cause` and formats error messages to never leak secret or setting values into messages, causes, stack traces, or logs.
5. **Verified Kimi model ID:**
   Added verified `moonshotai/Kimi-K2.7-Code` from Command Code's `/models` endpoint to `ops/service-dropbox/pi-models.commandcode.json`.
6. **Cross-platform tests and CI gate:**
   - Updated `ops/factory/install.test.mjs` to execute portably across Windows (Git Bash path conversion) and Linux.
   - Pinned `ops/factory/app/model-settings.test.mjs` to required Factory test suite in `.github/workflows/ci.yml`.

