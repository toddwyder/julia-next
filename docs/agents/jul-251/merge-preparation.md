# JUL-251 main adoption preparation

Todd's 22 October 2026 21:16 PT decision adopts pstack plus the short rulebook on main on probation. The Build card uses the same setup; its retro decides keep, adjust or revert. Spending remains $0. Publish and merge use ordinary signed-in gh.

The final implementation candidate is a22a340cf14ad4e984e22887fed6b907cc17cbc1. This preparation changes only documentation and retained evidence. PR #314's final documentation head must pass CI before gh merges it. The subsequent outcome report records that exact head, main's merge SHA, Linear Complete readback and the actual timer outcome.

Pocock triage reconciles the 14:50 PT start, 15:27 PT publication route, 20:06 PT follow-up and 21:16 PT merge authorization. The acceptance-criteria section is preserved verbatim. The final merged history and Complete status are written only after observing the merge.

The concurrency-proof and maintenance-correction-path findings are accepted by Todd, with one line for each in decisions.tsv. No new proof, control or acceptance criterion is added for either.

Preflight found PR #314 open and mergeable on the expected head, ordinary signed-in GitHub access working, the restricted agents-token file and directory at ubuntu 0600/0700, and the maintenance timer enabled with its main cursor at 97724ad3fb63937a7d5771ddbb63bc96c95ceaee. Node 24.14.1, Codex 0.163.0, Bubblewrap 0.9.0, Git 2.43.0 and gh 2.45.0 match the installed maintenance source's expected versions. Controller source hashes are read back against the committed candidate. The controller has no updater; the Codex startup-update setting is read without exposing authentication. Existing dirty worktrees remain untouched; this task uses an isolated worktree.

Documentation lookup: installed gh pr merge --help, gh pr checks --help and gh api --help; Linear's official llms.txt and indexed developers/graphql.md read in this session's retrospective; the local maintenance README, controller and installed systemd units. This is a documentation/status/merge task, with no framework or product-code configuration changes. Verification is a maker self-check of the actual diff, card sections, CI, main ancestry and timer state.
