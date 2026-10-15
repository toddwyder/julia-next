# JUL-229 framework map

| Job | Stock feature or project-local source | Version-matched documentation |
| --- | --- | --- |
| Generate the verification skill and feature map | Project-local Pstack `create-verification-skill` workflow | `.agents/skills/create-verification-skill/SKILL.md` and its `references/feature-map-example/` |
| Check the generated provenance and Markdown contract in the existing suite | Node 24 built-in test runner, strict assertions, SHA-256, and promise-based filesystem APIs | Node 24 [`test`](https://nodejs.org/docs/latest-v24.x/api/test.html), [`assert`](https://nodejs.org/docs/latest-v24.x/api/assert.html), [`crypto.createHash`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehashalgorithm-options), and [`fs/promises`](https://nodejs.org/docs/latest-v24.x/api/fs.html#promises-api) |
| Create, locate, parse, and read run-scoped evidence from PowerShell | Installed Windows PowerShell 5.1 filesystem and JSON commands | Installed `Get-Help New-Item -Full`, `Get-Help Set-Content -Full`, `Get-Help Get-Content -Full`, `Get-Help Get-ChildItem -Full`, `Get-Help Join-Path -Full`, `Get-Help Test-Path -Full`, `Get-Help ConvertTo-Json -Full`, and `Get-Help ConvertFrom-Json -Full` |
| Verify candidate identity and installed prerequisite paths | Existing project-local Doctor uses Git identity/diff inventory, Node SHA-256, and filesystem access | Git [`rev-parse`](https://git-scm.com/docs/git-rev-parse), [`diff`](https://git-scm.com/docs/git-diff), and [`ls-files`](https://git-scm.com/docs/git-ls-files); Node 24 [`crypto.createHash`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehashalgorithm-options) and [`fsPromises.access`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesaccesspath-mode) |
| Resolve Julia credentials through the provisioned restricted account | Existing project-local Windows vault launcher | `scripts/julia-vault-windows.ps1` and `docs/agents/julia-secret-vault.md` |
| Read the selected real Linear card without mutation | Existing `scripts/linear-cli.mjs get-issue` GraphQL query through the restricted named-secret launcher | Linear Developers [`GraphQL API: Getting started`](https://linear.app/developers/graphql.md), including API-key authentication, error handling, and the issue query |

No application framework or Mastra runtime behavior changes in JUL-229. The generated skill maps
and drives the existing commands; it does not introduce a new controller or service.

Generation provenance is recorded in `.agents/skills/verify-machine/generation.json`; the actual
five-question repository-and-laptop interview is retained at the evidence path named by that file.
The interview checked the exposed commands on the installed laptop, so currently failing or pending
routes are accounted for without being represented as working features.
