# Structural fence red proof

Exact pre-fix commit: `ecbff41`.

The tests ran from a fresh Linux clone at `/tmp/jul253-red-ecbff41` on the proof host.

| Required fence | Real attempt | Pre-fix result |
| --- | --- | --- |
| Historical evidence absent | Start a job from a repository containing `docs/agents/old-proof.txt`, `.audit/old-run.tsv`, and `agent-transcripts/old-session.jsonl`, then stat each path in the builder checkout. | Failed with `Missing expected rejection`; the old evidence remained present. |
| Outside-worktree data and cwd | Run `cat` against a sibling secret through `command-boundary.py`, then run the launcher with its cwd set to the worktree parent. | The existing Landlock rule blocked the sibling read, but the separate cwd test failed with `Missing expected rejection`; an outside cwd was accepted. |
| Control page and Start | Start a real localhost TCP listener, then run a TCP connection and HTTP POST through `command-boundary.py`. | Both attacks returned exit 0: `control_tcp_exit=0` and `start_post_exit=0`. |
| Server service | Start a real Unix-domain listener beside the worktree, then connect through `command-boundary.py`. | The attack returned `server_service_exit=0`; the launcher had no Unix-service fence. |
| Plan before build | Import and exercise the required planning gate. | Failed with `ERR_MODULE_NOT_FOUND` for `builder-boundary.mjs`; no plan phase existed. |
| Cheap research roles | Parse the effective machine role table and require DeepSeek for explorers, explainers, and investigators. | Failed because the observed route was `openai/gpt-6-sol`. |
| No prose substitute | Build a pstack session and reject the f5229f3 host-work prohibition. | Failed because the prompt still contained `Implement only ...` and `subject to the internal Build boundary`. |

The Linux test summaries were 0/2 for command-boundary, 0/1 for checkout, 1/2 for model settings, 6/7 for pstack-session, and a module-load failure for the missing plan gate.
