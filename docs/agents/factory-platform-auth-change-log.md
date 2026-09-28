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
