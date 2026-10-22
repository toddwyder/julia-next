# Framework/documentation map for this diagnosis

No framework was configured, upgraded or installed. No automatic updater ran.
Existing Node/npm/package versions were read; Codex's configured startup update
check is false. No claim is made about laptop updater state.

| Job | Installed tool/version | Exact documentation read |
| --- | --- | --- |
| Diagnosis procedure | Project skill | `.claude/skills/diagnosing-bugs/SKILL.md`, all phases read, only 1–3 used |
| Verify artifact readback | Project skill | `.agents/skills/principle-prove-it-works/SKILL.md` |
| Resolve owner dependencies | Node 24.14.1 | `https://nodejs.org/docs/v24.14.1/api/module.html#modulecreaterequirefilename`; web reader failed, same publisher page fetched directly and createRequire section read |
| Understand npm's failing operation | npm 11.11.0 | Installed `npm help ci` manual, especially automatic removal of existing node_modules and offline/ignore-scripts options |
| Preserve learning launcher semantics | @mastra/code-sdk 1.14.0 | Installed `/home/ubuntu/julia-jul-231/ops/build-runner/node_modules/@mastra/code-sdk/README.md`; no SDK boot/new call |
| Installed package context | @mastra/core 1.78.0 | Installed `dist/docs/references/docs-harness-agent-controller.md`; read only, no use/configuration of controller APIs |
| Provider package context | @ai-sdk/openai-compatible 2.0.87 | Installed `docs/index.mdx`; no provider instance or model call |
| Check rule removal | Codex CLI 0.163.0 | Installed `codex execpolicy check --help`; OpenAI Docs skill and official `https://developers.openai.com/codex/security/` (redirects to `https://learn.chatgpt.com/docs/security`), conceptual boundary only; actual verdicts from installed CLI |
| GitHub publication | gh 2.45.0 | Installed `gh api --help`, `gh repo view --help`, `gh pr create --help`, `gh pr merge --help`; ordinary signed-in Git access, no account change |
| Keep admin helper | Installed fixed script | `/usr/local/sbin/julia-framework-learning-run`, complete source read; no-argument root-only CLI |
| Historical browser trace | Existing Proof driver | Exact candidate dc7af214 and current `.agents/skills/verify-machine/drive-build.mjs`; no Playwright/browser execution or configuration |

The environment's Node/package versions match the named runner's recorded pins.
Core/provider ownership remains foreign. This report does not certify the
stopped installation, host configuration or pending adapted Windows runner.
