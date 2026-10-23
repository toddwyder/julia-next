# JUL-253 preflight sources

| Job | Documentation read | Installed evidence |
| --- | --- | --- |
| Locate card requirements | Linear's official llms.txt; indexed developers/graphql.md was attempted but the browsing service rejected its Markdown content type; connected get_issue and list_comments supplied the actual card | evidence/linear-card.json; evidence/linear-comments.json |
| Locate subscription sign-ins | Installed @mastra/code-sdk 1.14.0 README.md, auth/storage.d.ts, auth/types.d.ts, auth/providers/anthropic.d.ts and auth/providers/openai-codex.d.ts | evidence/credential-path-trace.txt; evidence/deployed-files.sha256 |
| Locate OAuth store | Installed SDK dist/auth/storage.js and dist/utils/project.js | evidence/credential-path-trace.txt |
| Confirm published stock route | [Mastra Code configuration](https://code.mastra.ai/configuration), indexed by [Mastra Code llms.txt](https://code.mastra.ai/llms.txt) | The configuration page describes /connect and /login and the app-data auth.json store. Its subscription table lists Claude Max. Claude Pro remains untested. |
| Check ordinary GitHub publishing access | Installed gh auth status, gh help, gh pr create --help, gh api --help | Signed-in repository access succeeded. Credential output is not retained. |
| Check installed runtime and keys | Node --version; op --version; committed server bootstrap read before execution | evidence/preflight.json |

The deployed SDK is exactly 1.14.0, matching its lockfile. No installation, updater or model inference was started. This is preflight evidence only. It does not establish subscription authentication, model availability, pricing, bounds, renewal, or the new cap.

## Implementation continuation

Todd's explicit continuation supersedes the prior parking decision. The missing sign-ins remain account actions, while independent implementation proceeds.

| Job | Exact documentation | Use |
| --- | --- | --- |
| Stock initial login and renewal | Installed SDK 1.14.0 `dist/auth/storage.d.ts`, `dist/auth/types.d.ts`, `dist/auth/providers/openai-codex.js:284-390`, `dist/auth/providers/anthropic.js:25-87` | AuthStorage.login owns both flows. ChatGPT uses authMode device. Claude waits for the hosted callback input. |
| Sol API-equivalent prices and context/output bounds | https://developers.openai.com/api/docs/models/gpt-6-sol | $2 input, $10 output, $0.20 cache read and $2.50 cache write per million; long-context tier is configured separately. Full context is 1,050,000 tokens. |
| Exact input reservation | https://developers.openai.com/api/docs/guides/token-counting | Public provider input count avoids an estimated tokenizer bound. Availability with the stock legacy subscription token remains a live verification question. |
| DeepSeek and Beam prices and bounds | https://commandcode.ai/docs/resources/pricing-limits and the real `/provider/v1/models` readback in evidence/commandcode-catalog.json | DeepSeek reserves at the published peak rate; Beam remains free. Actual settlement currently uses the configured peak schedule conservatively. |
| CommandCode stock custom provider | https://commandcode.ai/docs/byok; installed SDK custom-provider-source declarations | Runtime credential source supplies the CommandCode key. The real DeepSeek delegate completed through it. |
| Claude Haiku prices and bounds | https://platform.claude.com/docs/en/models/haiku-5-5/overview | Both prompt-length price tiers are configured. The stock conversation scope writes one-hour caches. The configured TTL and both one-hour cache-write price tiers match that default. |
| Settled Claude subscription decision | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan and https://code.mastra.ai/configuration | ADR 0022 records Todd's decision. Pro still needs its real request; no alternative Claude connection is authorized. |
| Locked SDK install | Installed npm 11.11.0 `npm help ci` | `npm ci --prefix ops/build-runner --no-audit --no-fund`; SDK remains pinned at 1.14.0. |

## Runtime dependency matrix

| Principal | Store or API | Mode | Test fixture | Real proof |
| --- | --- | --- | --- | --- |
| ubuntu runner host | Shared stock AuthStorage | Read/write and stock renewal | Existing SDK credential learning tests; login CLI status | Stock sign-in completion followed by proof/connections.mjs for each subscription |
| ubuntu runner host | Shared SQLite card ledger | Read/write | ledger.test.mjs and shared-ledger.test.mjs use separate processes and roles | Real DeepSeek delegate receipt and account readback for JUL-253 |
| ubuntu stock SDK | CommandCode provider | Inference and model catalog | Protocol tests guard parsing/accounting only | evidence/commandcode-catalog.json and evidence/deepseek-delegate.json |
| ubuntu stock SDK | ChatGPT stock inference and public input count | Read/inference | Exact input-count protocol fixture | proof/connections.mjs openai/gpt-6-sol after account authorization |
| ubuntu stock SDK | Anthropic stock inference | Inference | Messages JSON/SSE protocol fixtures | proof/connections.mjs anthropic/claude-haiku-5-5 after account authorization |

Local protocol fixtures do not replace the required live boundary proofs.

Node 24.14.1's [SQLite reference](https://nodejs.org/download/release/v24.14.1/docs/api/sqlite.html) and [readline reference](https://nodejs.org/download/release/v24.14.1/docs/api/readline.html) were fetched from the official versioned release after the browser could not retrieve the equivalent docs path. The installed SDK's `dist/headless/run-mc.d.ts` and `run-mc.js:245-276` explain why a one-assistant-turn limit can abort before completion; the connection proof now allows two turns. ESLint lookup used the installed README and `node_modules/.bin/eslint --help`. The required framework lint command passes but currently targets only the absent graph/langgraph tree, so it does not independently lint the changed runner.

The shortened review's first request used its whole output bound as reasoning and returned no visible report. Disabling thinking was rejected by the CommandCode route, so that response is unverified and its maximum was conservatively charged. The retry uses low effort and a larger, still-funded output reservation on the same model. [DeepSeek's thinking controls](https://api-docs.deepseek.com/guides/thinking_mode/) and [Chat Completions bounds](https://api-docs.deepseek.com/api/create-chat-completion/) were read from the publisher; its llms.txt endpoint was unavailable. The shortened review sends a fixed code packet through the same guarded transport and ledger instead of allowing an unbounded tool-reading session. It is a static code review, not an executed integration proof.

Installed SDK `dist/providers/claude-max.js:65-112` was read to verify its one-hour conversation cache default. The regression invokes that actual middleware, passes its cache control through the accounting boundary, and expects the literal one-hour API charge. It also proves that a mismatched TTL is refused. This is local stock-SDK compatibility evidence; live Pro remains unverified.

The live Sol proof exposed the stock hosted `web_search` default. Installed SDK 1.14.0 `dist/index.d.ts` documents `disabledTools`; `dist/agents/tools.js` creates provider-native search and filters disabled tools. The adapter uses that stock option to remove unpriced search while retaining local function tools. The regression drives `openRunner` with stock OAuth resolution and checks the actual outgoing request at a synthetic upstream boundary. It proves request compatibility, not live Sol execution. OpenAI’s [token-counting guide](https://developers.openai.com/api/docs/guides/token-counting) was reread after the live count endpoint rejected the legacy ChatGPT token with HTTP 401; it specifies API-key authentication and explains why local text tokenization alone does not count tools and framing exactly. No alternate count route or estimated bound was substituted.
