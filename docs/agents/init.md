# `$init` delivery entry point

`$init JUL-nnn` has one implementation: `initCommand` in
`ops/mastra-agents/reviewer/src/mastra/cli.ts`. The former
`scripts/julia-init.mjs` selection wrapper was a second implementation and has
been removed.

On Todd's Windows laptop, commands that need Julia vault secrets go through the
restricted service-account helper:

```powershell
.\scripts\julia-vault-windows.ps1 -JuliaArguments @('$init', 'JUL-225')
.\scripts\julia-vault-windows.ps1 -JuliaArguments @('$init', 'JUL-225', 'Start')
.\scripts\julia-vault-windows.ps1 -JuliaArguments @('$init', 'JUL-225', 'Cancel')
```

The first command reads the Linear card and displays the saved four-role model
choices and accepted limits. `Start` requires matching start authorization,
validated tested connections, current model offers, and a complete Ready card;
it saves the immutable run snapshot before delivery. `Cancel` does not dispatch.
A resumed run uses its saved snapshot rather than rereading role defaults.

Do not invoke a second script-level `$init`, and do not use personal 1Password
desktop authentication for commands that need Julia secrets.

## Local initialization control page

Double-click `Start Julia Control Page.cmd` to open
`http://127.0.0.1:43123/julia-control`. The launcher uses the restricted Julia
vault helper, and the server binds only to loopback. The page discovers current
Ready cards and current model offers without reading `role-defaults.json`.

Start creates or reuses one file-backed Mastra workflow run suspended at
`ready-for-build`; it does not execute a delivery role. Cancel removes the form
in the browser and sends no request. Close the launcher's window to stop the
local server. This control page is not a Factory route.

The same loopback server exposes `GET /julia-control/api/runs` as a read-only
validated machine boundary. It returns the complete initialized-run collection,
the independently computed total count, and structured activity counts. It has
no administration screen and never starts or resumes a run.
