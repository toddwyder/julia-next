# JUL-243 removal inventory — incomplete checkpoint

PR #301 is closed unmerged and its local/remote branch was deleted, with a one-line pointer to #303. The new branch starts at main `b2f0dfdb83b14e64b6867f9efce858f850829177`; commit `5cfd728` is not an ancestor. No private discovery or barrier Proof source was copied. Superseded JUL-243 plans were not copied; the root-cause record was retained.

## Server findings so far

No server files have been removed yet. This is a partial inventory, not a no-trace certification. The CommandCode preflight failure stopped the restart before removal work.

- Production `/opt/julia-control/reviewer` has no `agent-activity.ts` and uses the main-era initialization control server. Do not delete the existing production service or initialization database as a JUL-243 failure artifact.
- The existing `julia-control.service` is active, PID 50029, user julia-control. The only matching installed service unit found was this existing service; no separate JUL-243 service was found by the limited unit search.
- Production database `/var/lib/julia-control/initialization.db` and its WAL/SHM are retained production state.
- `.artifacts/jul-243-round2-proof/` is explicitly retained. `.artifacts/jul-243-restart-checks/` is prior evidence to remove; `.artifacts/jul-243-approved-restart/` is the new restart's diagnostic evidence.
- `/tmp/jul243-*` and `/tmp/jul-243-*` include prior login helpers, exported streams, review scripts, model catalogs, docs downloads, schemas, smoke workspaces, real Mastra databases, reconciliation tests, identity tests and browser-test workspaces. Exact-path deletion inventory is still required; do not blindly remove the current restart's sandbox check/schema or required retained records.
- `/tmp/commandcode-999/-tmp-jul243-service-smoke`, matching `/tmp/commandcode-1000/` test directories, and `/home/ubuntu/.commandcode/projects/tmp-jul-243-*` are prior run-owned state requiring exact removal. No private content was inspected for agent discovery.
- `/home/ubuntu/jul-243-plan.md` and `/home/ubuntu/jul-243-root-cause.md` are earlier duplicate handoffs; the retained repository root-cause record is the historical authority.
- `/tmp/jul243-agy` and related temporary tools/reviewer installations require disposition. Permanent prerequisites and sign-ins must remain intact.
- APT history records Playwright browser libraries/fonts/Xvfb installed on 19 October, plus gh 2.45.0. They support the settled browser Proof and GitHub handoffs; exact version inventory and dependency review remain open. btop was installed on 20 October outside this attempt; its ownership is unestablished, so it was not removed.
- This restart installed bubblewrap 0.9.0-1ubuntu0.3, apparmor-profiles/apparmor-utils 4.0.1really4.0.1-0ubuntu0.24.04.9 and their Python bindings; copied `/usr/share/apparmor/extra-profiles/bwrap-userns-restrict` into `/etc/apparmor.d/` and loaded it. The namespace restriction remains enabled. These are used by the settled design and remain.
- CommandCode was formerly recorded as 1.72.3; preflight subsequently found package version 1.84.0 and a transient missing dependency file. The catalog/account command did not disable auto-update. No model or purchase was invoked. Installation change provenance is not fully established; retain the failure record and do not call the version transition a verified intentional upgrade.

The complete service/process/package/settings/file/database inventory, exact removal manifest, removal execution and independent repository/server no-trace search remain open. No reviewer has certified this list.
