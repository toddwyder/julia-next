# Framework map — 22 October cleanup

| Job | Installed version | Documentation read |
| --- | --- | --- |
| Persist Codex mode and remove obsolete policy | Codex 0.163.0 | Installed `codex execpolicy check --help`; [official security documentation](https://learn.chatgpt.com/docs/security). Actual config readback and command verdict are retained; mode is also supplied by this session's environment. |
| Runner owns its lockfile installation | npm 11.11.0, Node 24.14.1 | Installed `npm help ci`: clean install removes node_modules, requires and does not update the lockfile. Historical createRequire probe retained at diagnosis-2026-10-21/item13.mjs. |
| GitHub publication and merge | gh 2.45.0 | Installed `gh pr create --help`, `gh pr checks --help`, `gh pr merge --help`; ordinary authenticated Git access. |
| Delete dedicated Cloud project | Google Cloud console, current web UI | Official [Delete and restore projects](https://docs.cloud.google.com/resource-manager/docs/delete-restore-projects), console shutdown and pending-deletion readback. Publisher cloud.google.com/llms.txt returned an HTML 404; followed the individual Resource Manager documentation link instead. |
| Request-failure Proof regression | Playwright 1.63.0 | See the framework map and real-browser red/green evidence on pushed JUL-231 commit 934df04. |

No dependency version was upgraded. Codex startup update checking remains false; npm ci installed exact owner lockfile contents. The retired Factory was neither created nor started. The fixed learning helper and permanent machine parts were retained. Cleanup readback is the maker's self-check, not independent review.
