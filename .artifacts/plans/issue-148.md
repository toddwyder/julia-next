# Issue #148 — Tell Todd when Factory is waiting on him

## Status and scope

This is a retrospective record of the implemented watcher. It was written after the watcher first went live at 01:21:29 UTC on 2026-09-29 and after Factory's first review of PR #150 requested changes. It does not claim advance plan approval. The watcher runs beside self-hosted Factory 0.17.2, reads its existing wait state, and publishes a link through ntfy for each newly observed actionable wait. It never writes Factory data.

Actionable waits are pending `ask_user` questions, pending `submit_plan` reviews, unresolved supervisor findings, and Work cards in Triage labeled `status: needs approval`. Intake automation suggestions, other decisions, and mentions are excluded. Each wait has a stable identity; the separate SQLite delivery ledger records an attempt before publishing so a crash or timeout cannot send a repeat. An uncertain attempt needs operator inspection and is not automatically retried.

## Framework map

| Need | Existing feature or gap | Official reference |
| --- | --- | --- |
| Identify human pauses | Factory's session questions, plan approvals, Needs attention, and Work item stages | [Mastra Factory guide](https://factory.mastra.ai/) |
| Ask a question or submit a plan | Mastra built-in `ask_user` and `submit_plan` tools; their suspended calls are the query seam | [Mastra built-in tools](https://mastra.ai/blog/introducing-built-in-tools) |
| Phone and Windows delivery | ntfy topic subscription and desktop PWA; Factory 0.17.2 has no built-in push alert for these waits | [ntfy desktop/PWA](https://docs.ntfy.sh/subscribe/pwa/), [ntfy publish](https://docs.ntfy.sh/publish/) |

The Factory alert gap and the watcher removal condition are recorded in `ops/factory/README.md`. Built-in alerts were requested in [Mastra issue #25378](https://github.com/mastra-ai/mastra/issues/25378).

## Seams and tests

- The source seam is `ops/factory/wait-alerts.sql`: a single PostgreSQL read-only transaction against Factory's wait records. The installed peer role has SELECT access only. The integration regression `ops/factory/wait-alerts.sql.test.py` executes that exact SQL with temporary tables shadowing Factory tables; it checks a fresh `ask_user` call, a fresh `submit_plan` call, a later result, an archived plan, and an unrelated suggestion. No live Factory row is edited by the test.
- `ops/factory/wait-alerts.test.py` covers delivery identity and duplicate suppression. `ops/factory/install.test.mjs` covers installer staging. `npm run lint:framework`, TypeScript check, build, and CI cover repository integration.
- Installed evidence: Todd confirmed #139 Triage approval reached both phone and Windows and its link opened the correct card. The first corrected full timer cycle sent zero new alerts, with only #139 remaining in the current list. Service restart and server reboot left the timer active, and repeated runs sent no duplicate #139 alert.
- **Still open:** an actual *new* session question or plan review must produce exactly one phone and Windows alert within five minutes. A SQL fixture or a previous Triage alert cannot satisfy this live criterion. Keep issue #148 open until it is observed.

## Observability

The one-minute systemd timer and service journal show each cycle and errors. The private SQLite ledger records a stable key, attempted time, and result without the ntfy topic or message contents. Operator dry-run lists current eligible waits without publishing. The change log records installation, the initial noisy alerts, the corrected first cycle, and the review-order breach. Do not log secret topic values or Factory private contents.

## Deployment and limits

The normal `ops/factory/install.sh` stages the watcher and SQL; server setup provisions the restricted peer role, private ntfy topic config, and systemd timer. The watcher was installed before Factory reviewed its PR. PR #149 was closed because Todd authored it; PR #150 reopens the same change under the Factory App. Leave the running watcher on while PR #150 is reviewed. Merge only on an approved Factory verdict at the reviewed head through the publisher App. Close #148 only after the separate live new-wait criterion passes.
