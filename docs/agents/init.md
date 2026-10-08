# `$init` model selection

`$init JUL-nnn` is the literal command that enters the Julia selection
wrapper. It is not `/init`, and it does not invoke a coding agent, read a
Linear card, create a worktree, or start the JUL-122 runner. JUL-196 consumes
the saved configuration when real startup and handoff are added.

The wrapper accepts either both role choices, one role choice, or neither:

```text
$init JUL-195 --builder "Anthropic Builder" high --reviewer openai-reviewer none
$init JUL-195 --builder anthropic-builder low
$init JUL-195
```

Each role value is an exact catalog display name (quoted when it contains
spaces) or a no-space catalog ID, followed by its thinking level. `none` is
the thinking-level word for a model whose catalog entry has no thinking
support. Builder and reviewer defaults are remembered separately in
`.julia/runs/defaults.json`; each new run receives an immutable non-secret
configuration in `.julia/runs/JUL-nnn.json`.

On Windows, enter `$init ...` directly in the coding-agent prompt. Do not
paste it unquoted into PowerShell: PowerShell treats `$init` as a variable.
For a shell-level diagnostic only, keep it literal with single quotes, for
example `node scripts/julia-init.mjs '$init JUL-195'`. The wrapper accepts the
literal string and rejects `/init`.

Invalid, stale, ambiguous, unsupported, missing, or same-maker pairs do not
change remembered defaults and do not dispatch. If a remembered role is stale,
the wrapper asks for that role while retaining the other valid selection.
Resuming a saved run without flags dispatches its saved configuration exactly,
even if the catalog or defaults have since changed.
