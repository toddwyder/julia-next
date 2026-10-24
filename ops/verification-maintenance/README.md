# Verification maintenance on the server

A user systemd timer polls the repository's watched branch every minute. The independent bare clone records an installation baseline, walks new first-parent commits, and recognizes merge commits by their parents. GitHub associated-PR metadata also recognizes squash and rebase merges by merged timestamp, base branch, and exact merge commit SHA. Ordinary direct commits advance the cursor without starting maintenance.

The durable key is the merge SHA under the configured repository and branch. The observer claims it before launching one fresh `codex exec` coordinator. A repeated observation cannot launch it again. A crashed claim becomes blocked with its retained evidence rather than guessing whether another session is safe. The cursor never silently resets after a rewritten history.

Targets are discovered from `.agents/skills/verify-*/SKILL.md` with a sibling `features/README.md`. No target list exists. The coordinator runs the actual `maintain-verification-skill` pass for each target, including its parallel source readers and live pass. It inherits the user's Codex model configuration and requires signed-in ChatGPT plan authentication. No provider API credentials are passed. Tool installation and model selection do not change during a poll.

Bubblewrap mounts the host and exact-merge checkout read-only. Target skill folders, disposable runtime output, scratch evidence, node_modules, and Codex session storage are writable. Git metadata and product source remain read-only during the session. Root dependencies are installed with the root lockfile before launch. The controller checks every changed path before publication. Runtime paths are disposable output only and cannot become proposed source corrections.

The structured outcomes are clean, changed, and blocked. Clean opens no branch or PR. Changed requires retained live proof and a nonempty correction confined to the discovered target folders, then the controller opens one combined PR with ordinary signed-in `gh`. Blocked opens no PR and automatically posts one plain-English line on JUL-251 through the stable `/home/ubuntu/julia-machine-main` vault wrapper and existing Linear CLI. The same line is retained in `runs/<merge-sha>/TODD.txt` in the state folder. The controller performs this outside the worker sandbox. Failed notifications remain pending and retry on later polls. A full merge-SHA marker is read back from the card's comments before posting, so delivery recovered after a lost response does not post twice. The run record retains the comment identity or delivery error. Session events, result JSON, scratch proof, and the exact source checkout remain beside that report. Product regressions remain blocked reports, never product edits.

## Installation

Run from this directory on the ubuntu server with its existing signed-in Codex and GitHub accounts.

```sh
npm ci
npm test
node install.mjs install
systemctl --user status julia-verification-maintenance.timer
node maintenance.mjs status ~/.config/julia-verification-maintenance/config.json
```

Installation pins the documented installed Node, Codex, Bubblewrap, and Git versions. It copies the controller and units to the user's installation, creates configuration only when absent, records the current main baseline, and enables the timer. Reinstalling retains the cursor and durable run claims. There is no updater in the service. The controller uses a separate clone and never relies on a developer worktree or modifies main.

```sh
node install.mjs uninstall
```

Uninstall disables the timer and removes its units. It retains state and proof. Re-enable the existing installation without resetting the cursor by running install again.

## Replays

```sh
npm test
node proof.mjs ../../docs/agents/jul-251/evidence/follow-up/maintenance-proof.json
```

The replay creates a real local repository and a throwaway branch standing in for main. Its only verification target is a small greeting CLI fixture with one feature. The maintenance skill itself is copied unchanged from this project. No merge and an ordinary direct commit start zero sessions. A true merge starts one actual signed-in fresh Codex session, and another poll starts none. The same sandbox rejects a product write with EROFS and permits a skill write. The replay retains real session events and live fixture output. It does not claim to have maintained Julia's complete feature map.
