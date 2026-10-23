# PR #316 correction framework map

| Job | Installed version | Exact documentation read |
| --- | --- | --- |
| Isolate Git config in builder commands | Git 2.43.0 | `/usr/share/man/man1/git.1.gz`, `GIT_CONFIG_NOSYSTEM`. Existing `/etc/gitconfig` reproduced CI's failure; the same command passes with the isolated environment. |
| Configure neutral helpers and inspect session evidence | @mastra/code-sdk 1.14.0 | `ops/build-runner/node_modules/@mastra/code-sdk/README.md`; `dist/index.d.ts` (`subagents`, `hostInstructions`); installed @mastra/core `dist/agent-controller/types.d.ts` (`subagent_start`, `subagent_end`, tasks). |
| Discover and cancel obsolete cards | Linear connected tools | [Linear GraphQL getting started](https://linear.app/developers/graphql.md), indexed by the official llms.txt. Canceled status is read back from Linear. The optional agent-context tool returned unavailable; issue tools worked. |
| Read PR checks and their annotations | gh 2.45.0 | Installed `gh pr view --help`, `gh run view --help`, `gh api --help`. |
| Observe service processes and restart the control page | systemd 255 | `/usr/share/man/man5/systemd.service.5.gz`, ExecStart and service process lifecycle. |
| Drive the saved-card Start journey | Playwright 1.63.0 | Installed `ops/mastra-agents/reviewer/node_modules/playwright/README.md` and `@playwright/test/README.md`; [Playwright introduction](https://playwright.dev/docs/intro). |
| Emit test failure annotations | Node 24.14.1, Bun 1.4.4 | [Node test reporters](https://nodejs.org/download/release/v24.14.1/docs/api/test.md); installed `bun test --help`; [Bun reporters](https://bun.sh/docs/test/reporters). |

Automatic updates were not invoked. Node, Bun, SDK and browser dependencies retain their pinned CI/lockfile versions. Sol's helper is configured with its exact identity but its plan connection remains unavailable as already excluded by the card. No price or working authentication is invented for it.
