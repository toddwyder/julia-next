# JUL-229 framework map

| Job | Stock feature or project-local source | Version-matched documentation |
| --- | --- | --- |
| Generate the verification skill and feature map | Project-local Pstack `create-verification-skill` workflow | `.agents/skills/create-verification-skill/SKILL.md` and its `references/feature-map-example/` |
| Check the Markdown contract in the existing suite | Node 24 built-in test runner, strict assertions, and promise-based filesystem APIs | Node 24 [`test`](https://nodejs.org/docs/latest-v24.x/api/test.html), [`assert`](https://nodejs.org/docs/latest-v24.x/api/assert.html), and [`fs/promises`](https://nodejs.org/docs/latest-v24.x/api/fs.html#promises-api) |
| Create and read run-scoped evidence from PowerShell | Installed Windows PowerShell 5.1 filesystem and JSON commands | Installed `Get-Help New-Item -Full`, `Get-Help Set-Content -Full`, `Get-Help Get-Content -Full`, and `Get-Help ConvertTo-Json -Full` |
| Verify candidate identity and installed prerequisite paths | Existing project-local Doctor uses Git identity/diff inventory, Node SHA-256, and filesystem access | Git [`rev-parse`](https://git-scm.com/docs/git-rev-parse), [`diff`](https://git-scm.com/docs/git-diff), and [`ls-files`](https://git-scm.com/docs/git-ls-files); Node 24 [`crypto.createHash`](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatehashalgorithm-options) and [`fsPromises.access`](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesaccesspath-mode) |
| Resolve Julia credentials through the provisioned restricted account | Existing project-local Windows vault launcher | `scripts/julia-vault-windows.ps1` and `docs/agents/julia-secret-vault.md` |

No application framework or Mastra runtime behavior changes in JUL-229. The generated skill maps
and drives the existing commands; it does not introduce a new controller or service.
