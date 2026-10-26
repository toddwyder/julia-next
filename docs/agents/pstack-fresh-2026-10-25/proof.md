# Fresh pstack and Mastra Code: proof

Branch `setup/pstack-fresh-2026-10-25`, 25 October 2026.

## pstack install

Source: `https://github.com/backnotprop/pstack` at `fad8d01588a1b1ae803f87c8a1e0de79e28cffec` (version 0.15.32).

```sh
npx skills add 'backnotprop/pstack#fad8d01588a1b1ae803f87c8a1e0de79e28cffec' \
  --skill '*' --agent codex --copy -y
```

Three extra trees were copied from the same commit because the documented install does not copy them: the Benny automation skills, `docs/`, `README.md`, and `LICENSE`. See `.agents/skills/PSTACK-SOURCE.md`.

Check output:

```text
Installed pstack matches https://github.com/backnotprop/pstack@fad8d01588a1b1ae803f87c8a1e0de79e28cffec, and @mastra/code-sdk is an exact registry install.
```

The check is `scripts/check-pstack-pin.mjs`. `scripts/check-pstack-pin.test.mjs` runs it against the checked-in tree, and the existing `package-tests` CI job runs that test file. It fails when an installed pstack file differs from the mirror, when `@mastra/code-sdk` is not exact, or when a local patch mechanism exists. The test file's unit and integration tests: 5 passed.

## Adapter learning tests

`ops/build-runner/framework/@mastra/code-sdk/adapter-facts.test.mjs`, 3 passed:

```text
{"fact":"model-per-subagent","perType":"commandcode/deepseek/deepseek-v4.1-flash","global":"anthropic/claude-opus-5-5"}
{"fact":"reasoning-effort-per-subagent","supported":false,"sessionScoped":true}
{"fact":"settings-file-loading","instruction":"AGENTS.md","sources":["/home/ubuntu/julia-builder/AGENTS.md"]}
```

The first two drives use no inference: `{"fact":"framework-only-drive","inferenceAttempts":0}`.

## Old machine units

Stopped and disabled, with `systemctl --user reset-failed` after the two services stopped into `failed`:

```text
julia-machine-control.service                 active=inactive   enabled=disabled
julia-machine-runner.service                  active=inactive   enabled=disabled
julia-machine-main.timer                      active=inactive   enabled=disabled
julia-machine-main.service                    active=inactive   enabled=static
julia-server-tests.timer                      active=inactive   enabled=disabled
julia-server-tests.service                    active=inactive   enabled=static
julia-verification-maintenance.timer          active=inactive   enabled=disabled
julia-verification-maintenance.service        active=inactive   enabled=static
```

No `server-main.mjs`, `worker.mjs`, or verification-maintenance process is running. Unit files and code remain in place. A detached `tmux julia-codex` shell remains in `/home/ubuntu/julia-machine-main`; it is a shell, not a service.

## Server-owned tests

The server-owned tests pass on this candidate: 4 + 2 + 1 tests, exit 0. The receipt is published at `refs/notes/julia-server-tests/<candidate head>`. The worker was run once by hand with its service PATH because the `julia-server-tests` timer is off; the timer stays off.

## Mastra Code program

The program is the separate package `mastracode`, not `@mastra/code-sdk` (`node_modules/mastracode/package.json:2-3`, bin at `:21`). Version 0.47.1 declares `@mastra/code-sdk: ^1.14.0` (`:103`). It is installed with that dependency pinned to 1.14.0:

```text
mastracode-program@ /home/ubuntu/.local/lib/mastracode-program
├── @mastra/code-sdk@1.14.0
└─┬ mastracode@0.47.1
  └── @mastra/code-sdk@1.14.0 deduped
```

`/usr/local/bin/mastracode` and `/usr/local/bin/mastra-code` now point at `node_modules/mastracode/dist/cli.js`. They previously pointed at `command-code`, which is still available as `command-code`.

Auth and storage readback, with the program's own SDK:

```json
{"settingsPath":"/home/ubuntu/.local/share/mastracode/settings.json","databasePath":"/home/ubuntu/.local/share/mastracode/mastra.db","anthropicSignedIn":true,"openaiCodexSignedIn":true,"envApiKeys":{"ANTHROPIC_API_KEY":false,"OPENAI_API_KEY":false}}
```

Model reachability, one minimal headless turn each, no API-key environment variables set:

| Model | Command model id | Result |
| --- | --- | --- |
| Opus 5.5 | `anthropic/claude-opus-5-5` | `{"status":"completed","text":"OK","finishReason":"complete","exitCode":0}` |
| Sol 6.1 | `openai/gpt-6.1-sol` | `{"status":"completed","text":"OK","finishReason":"complete","exitCode":0}` |
| DeepSeek V4.1 Flash | `commandcode/deepseek/deepseek-v4.1-flash` | `{"status":"completed","text":"OK","finishReason":"complete","exitCode":0}` |

DeepSeek uses a CommandCode custom provider added to the existing settings with the `COMMANDCODE_API_KEY` already on the machine. The key is not printed or stored in the repository.

## Opening a fresh clone on Opus 5.5

```sh
git clone https://github.com/toddwyder/julia-next.git ~/julia-fresh
cd ~/julia-fresh
MASTRACODE_MODEL_ID=anthropic/claude-opus-5-5 mastracode
```

Verified in a fresh clone with a pseudo-terminal. After the one-time onboarding screen, the status bar read:

```text
build · anthropic/claude-opus-5-5 · 0/70k 0% · …/fresh-julia (main)
```

The TUI offers an update to 0.48.0. Decline it while the machine stays on `@mastra/code-sdk` 1.14.0; the pinned install is 0.47.1.
