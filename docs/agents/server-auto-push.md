# OVH Julia automatic push — 21 October 2026

Installed for Julia repositories through `/home/ubuntu/.gitconfig` with the requested `includeIf "gitdir:/home/ubuntu/julia*/**"` condition, including linked worktrees. The included `/home/ubuntu/.config/git/julia-auto-push.gitconfig` sets `core.hooksPath = /home/ubuntu/.config/git/julia-hooks`.

`post-commit` first runs the executable conventional repository hook at `$(git rev-parse --git-common-dir)/hooks/post-commit`, preserving linked-worktree ownership and guarding against self-recursion. It then skips detached HEAD and main; other branches run `git push -u origin HEAD`. Hook/push errors are visible on stderr and the hook exits 0, preserving the local commit. As with any Git hook, a later explicit configuration override can replace this setting. This is a server Git convenience, not the proposed framework guardrail enforcement.

## Commands actually run and results

1. Read installed Git 2.43.0 `git-config(1)` includeIf/gitdir and core.hooksPath documentation and `githooks(5)`; installed CLI help for Tailscale Serve and `gh pr create`, `gh pr checks`, `gh pr merge`. Git CLI is the installed OS package, with no updater invoked. Existing signed-in GitHub access used; no paid model call.
2. `git fetch origin main`: exit 0; main 9156548. `git worktree add -b ops/server-auto-push-20261021 /home/ubuntu/julia-server-auto-push origin/main`: exit 0. Existing dirty worktrees were preserved.
3. Wrote `/tmp/julia-auto-push-test.py`; `python3 /tmp/julia-auto-push-test.py /home/ubuntu/.config/git/julia-hooks/post-commit`: exit 1 before installation, because the repository hook did not execute. Saved red output.
4. `mkdir -p /home/ubuntu/.config/git/julia-hooks`; wrote the exact post-commit retained in `server-auto-push/evidence/post-commit`; `chmod 755 /home/ubuntu/.config/git/julia-hooks/post-commit`: success. Wrote included `julia-auto-push.gitconfig`; `git config --global 'includeIf.gitdir:/home/ubuntu/julia*/**.path' /home/ubuntu/.config/git/julia-auto-push.gitconfig`: exit 0. Existing credentials configuration preserved.
5. Repeated the real local Git/bare-origin test: exit 0. Main and detached commits were not pushed, the repository hook executed even when it returned 9, a feature commit reached its origin with upstream set, and a missing origin preserved a successful local commit. Test source and output are retained.
6. `git -C /home/ubuntu/julia-framework-preplan config --show-origin --get core.hooksPath`: exit 0; included file resolves the installed path.
7. `git -C /home/ubuntu/julia-framework-preplan commit --allow-empty -m 'test(ops): prove post-commit automatically pushes pre-plan HEAD'`: exit 0, automatically created remote branch `preplan/framework-learning-tests` at d7ceca9ac2bfea28ce0a0620e5c4d7f82b60d1d1 and set its upstream. No manual push was run. `gh api repos/toddwyder/julia-next/git/ref/heads/preplan/framework-learning-tests --jq .object.sha`: exit 0, exact same SHA. That commit has no tree changes and contains both f30e82b and 0a5ad03 in its ancestry.
8. Copied original Shape agent findings, both sketches and final prototype stdout from the retained original session into `docs/agents/framework-guardrails/evidence/` on the pre-plan branch, with source provenance and checksums. Historical four-pass/one-deliberately-red evidence remains honestly labeled. No Shape approval or JUL-231 restart is implied.

## Verification scope

Maker self-check: actual Git commits and bare-origin ref comparisons plus real GitHub ref readback. The proof exercises the requested OVH server path. Julia product UI, Windows launcher/vault and delivery runner were unchanged, so Windows machine UAT and browser console checks do not apply. No synthetic AI result is presented as a passing model Proof. Hook push failures identify the failed operation and preserve Git diagnostics; no secrets are printed.

Evidence is in `server-auto-push/evidence/`. The final delivery response names the pushed candidate and main merge commits.
