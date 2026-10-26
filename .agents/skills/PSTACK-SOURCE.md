# pstack source

Mirror: https://github.com/backnotprop/pstack
Commit: fad8d01588a1b1ae803f87c8a1e0de79e28cffec
Version: 0.15.32 (`.cursor-plugin/plugin.json` and `plugin.json` at that commit)
Installed: 25 October 2026

This is the backnotprop mirror, not Cursor's `cursor/plugins` copy. The mirror's harness-neutral rewrites are what let pstack run outside Cursor.

## Install

The mirror documents `npx skills add backnotprop/pstack` (README.md:32-38). The `skills` CLI accepts a `#<commit>` fragment, so the install is pinned to the commit above:

```sh
npx skills add 'backnotprop/pstack#fad8d01588a1b1ae803f87c8a1e0de79e28cffec' \
  --skill '*' --agent codex --copy -y
```

`--agent codex` selects `.agents/skills` (the CLI's `codex` target), and `--copy` stores plain files instead of symlinks. The command installs the 58 skills under `skills/` byte for byte.

Three more trees come from the same commit because the documented install does not copy them:

- `automations/benny/skills/` → `.agents/skills/` (the three Benny automation skills; the retained recovery prompt reads `reproduce-and-fix-issues/SKILL.md` at `scripts/julia-delivery-recovery.mjs:100`).
- `docs/` → `.agents/docs/` and `README.md` → `.agents/README.md` (the installed `poteto-help` skill links to `../../docs/` and `../../README.md`).
- `LICENSE` → `.agents/skills/PSTACK-LICENSE.txt`.

`scripts/check-pstack-pin.mjs` fails CI if any of these installed files differs from that commit; `scripts/check-pstack-pin.test.mjs` runs the full check in the existing `package-tests` job.

Julia's own skills are not pstack files and were left in place: `verify-julia`, `adversarial-review`, `playwright-cli`.

## Not installed

- `deslop`, `control-cli` and `control-ui` come from Cursor's `cursor-team-kit` plugin and are not shipped by pstack.
- The `create-skill` skill is Cursor-built-in. Use the Agent Skills format instead.
