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
