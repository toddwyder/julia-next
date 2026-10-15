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
