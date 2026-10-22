# 22 October cleanup and diagnosis

Todd’s binding decision: 21 October 2026 20:05. This report supersedes the outstanding cleanup status in diagnosis-2026-10-21. Cleanup readbacks below are maker self-checks.

## Published decisions

PR [311](https://github.com/toddwyder/julia-next/pull/311) merged as `1c6777f1af5dc75cecee358be937cea0af656c22`; reviewed candidate `18ee208300affcd6cbeb0bdfc688b91321194e05`. Independent Standards and Spec reviewers inspected both documentation files and passed. CI passed on the candidate. Main contains the candidate. The three stop-rule paragraphs match Todd’s supplied text; pre-plan refers to AGENTS.md in both locations.

## Cleanup

- Persisted `approval_policy = "never"`, `sandbox_mode = "danger-full-access"` in `/home/ubuntu/.codex/config.toml`, then read them back. This session's supplied environment independently reports both values. Codex startup update checking remains false.
- Deleted the dedicated rclone configuration, containing only the `julia-evidence` remote. Deleted its dedicated OAuth credentials, config-flow state and signed-in setup browser profile after Cloud cleanup readback.
- Removed the sudo catch-all from `/home/ubuntu/julia-next/.codex/rules/repository.rules`. That file already had zero prompt rules; the three lingering prompt rules were removed from the stale approvals checkout before its deletion. Actual deploy-helper `codex execpolicy check` verdict: `allow`. Policy change is pushed as `b4729b2ef2b86e90737726735706297186cf0b8d` on `ops/remove-policy-catchall-20261022`; main has no `.codex` policy file, so this does not restore it there.
- Removed stale Drive and approvals worktrees and local branches. Both abandoned remote branches are absent. Kept the active learning/runner checkouts and pre-existing JUL-243/PR302 evidence outside this cleanup's scope.
- Through the existing dedicated signed-in Google profile, shut down project `julia-evidence-20261021`. Google confirmed it is scheduled for deletion after 21 November 2026. A fresh console readback lists it under Resources pending deletion; its OAuth client page says “No OAuth clients to display.” This is scheduled project deletion, not a claim that Google's 30-day retention has elapsed.

See readback.json and evidence/deploy-policy.json, julia-cloud-readback.txt and julia-cloud-client-readback.txt. The fixed learning helper and permanent machine parts remain installed. No retired Factory route was started or repaired.

## Item 13 — owner installation

Cause: the runner's dependency links resolved into the abandoned trial installation. `item13-red.txt` shows both packages resolving there. Ran `npm ci --no-audit --no-fund` in `/home/ubuntu/julia-jul-231/ops/build-runner`: exit 0, 745 packages installed from that owner's lockfile. `item13-green.txt` shows both packages resolving under the runner. Then deleted `/home/ubuntu/mastra-trial`. The search in evidence/julia-trial-search.txt finds remaining names only in historical docs, diagnostic probes and session logs; no live dependency/configuration reference remains in searched `/home/ubuntu`, `/opt`, `/etc` (excluding Git internals, package caches and node_modules). The real installed dependency resolution is checked separately.

## Item 27 — full-access comparison

Cause: the prior session's read-only sandbox mount. Historical diagnosis-2026-10-21/item27-original-red.txt retains EROFS unlink output. The original probe refused writable installs, so updated it to perform the now-authorized full `npm ci`, with success and failure verdicts and a 180-second timeout. Its destructive unlink-only reduction still refuses writable installs. Full-access rerun exited 0 in 52.315 seconds (`item27-green.txt`), while the historical exact syscall was errno 30 on the same owner path. Closed as sandbox-caused.

## Item 2 — failed-request blindness

Historical URLs cannot be recovered. Existing watcher fix `1d96bc3` records URL, ISO timestamp and error text for each requestfailed event, and the driver saves these in failure artifacts. Added a real-browser regression at that interface, showed it red by removing the listener and green with the listener restored. Candidate `934df044c9fd5ef4be10376f262ce6e3bcc07c67` is pushed on `julia-build/jul-231`; two independent reviewers reran green and passed Standards and Spec, with original-request recovery explicitly out of scope. See that commit's diagnosis-2026-10-22/item2.md, framework-map.md, and raw evidence. No Build dispatch or service restart was needed for the logging test.

## Item 28

Learning diagnosis and request-rate experiment are ongoing; final results will be published on `preplan/framework-learning-tests`. This paragraph is a checkpoint, not a claim that learning verification has passed.
