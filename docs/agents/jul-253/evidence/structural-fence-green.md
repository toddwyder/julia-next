# Structural fence green proof

Exact repair commit: `1471729`.

The checks ran from a fresh Linux clone at `/tmp/jul253-green-1471729` on the proof host.

| Required fence | Observed result |
| --- | --- |
| Historical evidence absent | The job fixture kept `README.md` and exact detached HEAD while `docs/agents`, `.audit`, and `agent-transcripts` returned `ENOENT`. |
| Outside-worktree data and cwd | The real launcher blocked the sibling-file read and refused an outside cwd. |
| Control page and Start | Real TCP and HTTP POST attempts through `command-boundary.py` failed before reaching the localhost listener. |
| Server service | A real Unix-domain socket connection through the launcher failed. |
| Plan before build | The plan gate accepted exactly one `write_file` event for `.builder-home/pstack/plan.md`, retained `pstack-plan.md`, and rejected a prior read/delegation event, repository changes, and oversized plans. |
| Cheap research roles | The effective table routed `how explorer`, `how explainer`, and `why investigators` to DeepSeek. `why synthesizer`, main-session judgment, and review remained on Sol. |
| No prose substitute | The session regression confirmed the f5229f3 host-work prohibition is absent. |

Focused Linux result:

```text
tests 15
pass 15
fail 0
skipped 0
```

Complete Linux build-runner result:

```text
tests 83
pass 83
fail 0
skipped 0
```
