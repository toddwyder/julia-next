# Cleanup and diagnosis — 21 October 2026

Executed 22 October UTC against the work left from 21 October. Todd stopped all
implementation. No fixes, features, enforcement changes beyond the requested
cleanup, instrumentation, paid inference, independent review, Triage, or cards.
This is maker self-check evidence. **The requested finish line is only partially
reachable from this session.** Do not interpret the unavailable results as passes.

## Part 1: removal and readback

| Item | Actual result |
| --- | --- |
| 17 | Removed only the misplaced “Before reporting a stop…” paragraph from `AGENTS.md` on GitHub branch `julia-build/jul-231`. Commit `cc5e9e0108b600d21b08be5ed0ba1bdc99f95344`. Main retains its existing report/evidence publishing rule. The old local worktree remains at its old commit because its filesystem is read-only here. |
| 18 | Preserved the abandoned Drive setup record as historical evidence at `docs/agents/drive-evidence-setup.md` in the publication commit. Direct push to main was rejected by GitHub's required PR/check rules; use the ordinary PR/CI path. Dedicated rclone config has only `[julia-evidence]`; unlink failed EROFS, so remote/config remain locally. Local Drive worktree removal failed EROFS; branch deletion then refused because that worktree still uses it. Cloud project deletion awaits the single account-action approval requested in the reply. No account action attempted. |
| 24 | Attempted removal of only the sudo catch-all; write failed EROFS. The live file still forbids both helpers. `requested-repository.rules.txt` is evidence of the requested removal, **not installed policy**. Actual `codex execpolicy check` results show requested policy allows deploy and learning helpers and still forbids systemctl restart and force push. Comparison retains every other forbidden entry. |
| 26 | Cannot confirm zero prompt rules: three remain in `/home/ubuntu/julia-codex-approvals/.codex/rules/repository.rules`, lines 91–93 (gh authentication, gh api, shell commands). Attempted deletion failed EROFS. No prompt rules found in the current repository rules or user rule directory. Laptop rules were unavailable. |
| Codex harness | Removed runnable `framework/codex/no-verify-attempts.mjs` from GitHub branch `preplan/framework-learning-tests`, commit `cde6d4f3a7bc7d3758adf0718c63634beb160d1b`; updated its Shape wording to historical evidence only. `git ls-tree` shows no `framework/codex/` files; `git grep` finds no active source reference. Historical result documents remain. Local unlink failed EROFS, so the old local checkout still contains the file. |
| Temporary work | Deleted 28 owned disposable paths dated 21 October: SDK-memory/prototype directories, free-model catalog scratch directories, Drive browser/configuration/policy scripts and downloads, npm scratch cache, JUL-231 scratch files and the handoff. `/tmp/framework-shape-secret-run.py` was already absent and remains absent. Per-path deletion and absence results are recorded. No active main/learning source references the removed paths; historical evidence may name them. |
| Other unrecorded work | Removed the 21 October uncommitted policy prose from AGENTS.md and CLAUDE.md by restoring their current HEAD bytes, with hashes and equality readback. Moved five loose prior-session diagnostic records into `previous-session/` to preserve them under the requested evidence destination. Older JUL-243/PR302 artifacts are outside this day's cleanup and retained. |

`cleanup-commands.json`, `additional-cleanup.json`, `branch-cleanup.json`,
`cleanup-readback.json`, and `readback.json` contain actual results. Remote branch
heads were read back with `git ls-remote`; historical docs are deliberately
retained references, not active dependencies. Local stale copies are explicitly
outstanding; complete local absence is **not** claimed. The protected rclone
binary was not uninstalled: it was installed for this abandoned setup, but is
outside the writable roots, like its config. No claim that it is needed is made.

Keep: `/usr/local/sbin/julia-framework-learning-run`, byte SHA-256
`e14d1ce27f162203c228f34d1ce41ee0caf00f85de6785f5d041c60002745aa0`, mode 0755.
The sandbox presents its owner as uid 65534; that is not an independent host
ownership check. Its behavior is not changed. Keep `/home/ubuntu/mastra-trial`,
the stopped runner and installation, all 530 trial-pointing dependency links,
permanent machine parts, and recorded historical evidence. No runner/service
start or restart occurred. Live user-service status is unavailable because this
sandbox cannot connect to the user bus; do not infer process liveness from that.

### Codex locations

| Place | Approval | Sandbox | Evidence |
| --- | --- | --- | --- |
| OVH on disk | `never` | `julia-delivery` extends `:workspace`; `/opt/julia-control` additional write root; network enabled | `/home/ubuntu/.codex/config.toml`, hash in `readback.json`; startup update checks disabled |
| This OVH session | `never` | `workspace-write`; repository, `/opt/julia-control`, `/tmp` writable; protected `.git` and `.codex` remain read-only | Managed session configuration, `statvfs`, `/proc/self/status`: NoNewPrivs=1 |
| Todd's laptop | **Unknown, not inferred** | **Unknown, not inferred** | No exposed machine connector or existing reverse authenticated laptop route; OVH SSH directory contains authorized_keys/backups only. Earlier route research is retained in the Drive record. Laptop untouched. |

A disabled approval prompt is not evidence of unrestricted filesystem access.
No escalation, reverse-key copying, nested unsandboxed runner, or other sandbox
escape was used. No repository fix can grant this session host access. The
remaining local cleanup and outside-sandbox readback remain outstanding; no
workaround approval is requested.

### Item 23: readers only

See `item23-readers.md`. No token-read repair, sudoers change, new reader,
credential extraction, or new secret transport was performed. Failed helper
invocations in this session did not reach credential reading.

## Part 2: Phases 1–3 only

Read `.claude/skills/diagnosing-bugs/SKILL.md` in full. Its Phase 1 prohibition on
hypothesising without an actual symptom loop governs the unavailable items.
No Phase 4 instrumentation or hypothesis experiments; no Phase 5 fixes.

### Item 2 — browser console refusal: Phase 1 unavailable

Attempted command:

```sh
node docs/agents/diagnosis-2026-10-21/item2-replay.mjs
```

Actual output, exit 1:

```text
REPLAY RED (historical assertion only): ["Failed to load resource: net::ERR_CONNECTION_REFUSED","Failed to load resource: net::ERR_CONNECTION_REFUSED"]
```

The script reads the real retained failure and checks the historical candidate's
actual final assertion text before replaying it. This demonstrates the old
assertion failure, **not a live request reproduction**. The smallest retained
input is the two console strings; run ID, candidate marker, screenshot and
snapshot are unnecessary for that assertion. This is not a completed Phase 2
minimisation of the underlying network failure.

Tried: read the named root-cause report and all four retained artifact names;
read `failure.json`; inspect the driver at exact candidate
`dc7af2145f7407f2e616536053a19b3056845048`; compare the current driver. The
historical candidate collected console/page errors across its restart journey;
its artifacts contain no failed-request URLs or times. The current driver has
subsequent changes and cannot be substituted for that candidate. A full rerun
would start a new Build and restart services, contradicting the instruction to
leave the stopped runner/install untouched. No arbitrary refused request or mock
server was manufactured as a substitute. No HAR/request trace is present in the
named evidence directory. A red-capable loop on the original requests could not
be built. Stop this item at Phase 1: **no causal hypotheses or claimed request
identities**. No instrumentation added.

### Item 13 — dependency ownership: red, reproduced, minimised

Loop (exit 1; 0.08–0.09 seconds in retained runs):

```sh
node docs/agents/diagnosis-2026-10-21/item13.mjs
```

```text
RED @mastra/core: /home/ubuntu/mastra-trial/route-a/node_modules/@mastra/core/dist/index.cjs
RED @ai-sdk/openai-compatible: /home/ubuntu/mastra-trial/route-a/node_modules/@ai-sdk/openai-compatible/dist/index.js
```

Two repeated full probes and both one-package reductions went red (4/4).
The resolution uses the owning runner's `createRequire(owner/package.json)`
seam used by the learning tests. It exercises dependency resolution without
booting the SDK, runner or inference. The CJS core entry is reported literally;
this is a package-owner check, not a claim to have executed the ESM runtime.
The same canonical package directory is the ownership symptom.

Minimised commands (each independently red):

```sh
node docs/agents/diagnosis-2026-10-21/item13.mjs @mastra/core
node docs/agents/diagnosis-2026-10-21/item13.mjs @ai-sdk/openai-compatible
```

One owner anchor, one package name and Node resolution suffice. No SDK boot,
model, framework test, environment credential, package import side effects or
realpath traversal beyond resolution is needed. `item13-runs.json` records all
runs. Removing the resolution removes the failure-producing operation; removing
the foreign installed target would remove this ownership symptom. No dependency
was deleted for that counterfactual because the installation is under diagnosis.

Ranked falsifiable hypotheses, not tested after ranking:

1. **Direct links in the owner install lead into trial.** If these are the cause,
   an otherwise identical isolated owner install containing real package
   directories instead of those links will resolve within its own directory;
   preserving the links will preserve the foreign path.
2. **The SDK itself resolves transitives relative to its canonical trial
   location.** If this is additionally responsible at runtime, replacing only
   the top-level core/provider links in an isolated fixture will leave
   SDK-anchored resolution foreign, whereas relocating the SDK will change it.
3. **An ambient Node resolution override selects trial.** If this contributes,
   the same owner fixture with a clean environment and stock Node flags will
   change the path while the unchanged install with the ambient environment
   will not. The earlier record says NODE_PATH was unset, reducing this rank.
4. **Package export/entry metadata redirects outside the owner.** If this is
   responsible independently of links, a copy with real directories but
   unchanged metadata will still resolve outside; replacing only the metadata
   in that disposable copy will remove the foreign resolution.

### Item 27 — npm EROFS: sandbox red; host comparison unavailable

Loop:

```sh
python3 docs/agents/diagnosis-2026-10-21/item27.py
```

Representative actual output (npm exit 226, diagnostic exit 1):

```text
{"exit": 226, "seconds": 1.107, "red": true}
npm error code EROFS
npm error syscall unlink
npm error path /home/ubuntu/julia-jul-231/ops/build-runner/node_modules/.bin
npm error errno -30
```

The loop first refuses any writable view of the installation, so it cannot
successfully clear or reinstall dependencies. It uses the real npm command
and actual owner directory, with a disposable cache deleted in `finally`.
The read-only installation was unchanged; 530 foreign links remain. Npm's
installed manual explicitly says `npm ci` removes existing node_modules first.
The failure occurs in that removal, before a clean install can proceed.

One early assertion was too narrow: npm reported `.package-lock.json` before
`.bin`, due to concurrent removal. It exited 2 (unclassified), not green.
The final loop checks the exact requested EROFS unlink symptom under the owner
node_modules, without insisting which concurrent unlink reports first. The
corrected original invocation went red 2/2; offline/no-script reductions also
went red 2/2. All results, including the narrow assertion, are retained.

Minimisation, each run retained in `item27-runs.json`:

```sh
python3 docs/agents/diagnosis-2026-10-21/item27.py --minimal
python3 docs/agents/diagnosis-2026-10-21/item27.py --syscall
```

The first removes network and lifecycle execution; EROFS persists. The second
removes npm, manifests, dependency solving and downloads entirely, invoking
only the failing unlink on the same `.bin` path under the read-only precondition:

```text
RED unlink node_modules/.bin: errno=30 Read-only file system
```

That exact syscall was red 2/2. No successful unlink occurred. Both the owner
and node_modules have `ST_RDONLY` in this session; `/tmp` does not.
**This explains the observed failure here, but does not establish whether npm
fails in the ordinary host namespace.** The session prohibits escalation and
has no existing authenticated external command route. No outside-sandbox run
was performed or implied; no changed sandbox was launched to bypass this.

Ranked remaining hypotheses for the missing host comparison, untested:

1. **Sandbox-only read-only mounts cause the failure.** If so, the same pathname
   in the existing ordinary host session has ST_RDONLY clear and its equivalent
   isolated install/removal works; this session continues to fail.
2. **A host-level read-only bind mount also covers the installation.** If so,
   the ordinary host mount table still shows that pathname as read-only even
   when its backing filesystem is writable; outside-sandbox removal also fails.
3. **The host backing filesystem itself is read-only.** If so, ordinary host
   writes elsewhere on that same filesystem also fail EROFS and the backing
   mount reports read-only. The sandbox's writable exception paths and reported
   backing mount options make this lower ranked; host readback is required.

Do not execute the unlink-only reduction in a writable namespace: it deliberately
refuses that case. An outside-sandbox destructive install is not authorized by
this report while the instruction to preserve the installation remains in force.

### Item 28 — MiniMax 429: Phase 1 unavailable

Attempted authorized launcher:

```sh
sudo -n /usr/local/sbin/julia-framework-learning-run
```

Actual exit 1, before a model request:

```text
sudo: The "no new privileges" flag is set, which prevents sudo from running as root.
```

The same attempt also reports the sandbox's uid-65534 sudo.conf view. This is
**not HTTP 429** and is not a red loop for the model symptom. No provider key or
service-account token is in this session's environment. Only the fixed launcher
was attempted; no direct sudo token reads, alternate secret route or paid model.

Tried: read the fixed launcher's exact accepted command and environment; attempt
it; inspect the existing learning-test entry point and real-route setup to find
an already authorized narrow invocation. The installed no-argument launcher
accepts only the whole fixed 14-test suite, not a spacing/concurrency/prompt-size
matrix; it cannot run here at all. It was kept unchanged, as requested.

Historical `final-outcome.json` reports 4 failed tests / 14 total tests (28.6%)
in one run, all four failures labelled MiniMax HTTP 429. This is **not a new
reproduction rate**, not a rate over fourteen MiniMax requests, and not evidence
for a spacing/concurrency/prompt-size effect. The retained harness uses serial
file execution and a 10-second delay before each intercepted inference request;
those source facts do not identify what caused the historical responses.
No new model calls were made. A pinned live reproduction rate and a minimised
real-provider loop could not be established. Stop at Phase 1: **no ranked
hypotheses or claims about variation effects**, per the skill's explicit rule.

## Outstanding account action

Single approval requested in the reply: delete Google Cloud project
`julia-evidence-20261021` and its contained dedicated OAuth client/configuration.
The retained Drive setup record identifies the project and client; no new
Google account access route is available in this session. No project deletion
was executed. Reversible local cleanup failures require a session with the
existing host access, not a new guardrail or a workaround authorization.
