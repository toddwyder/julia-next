# pstack and Mastra Code deviations

One row per place Julia departs from stock pstack or stock Mastra Code. A row without Todd's approval is a proposal, not a rule.

| # | What differs | Why | Line departed from | Todd's approval |
| --- | --- | --- | --- | --- |
| 1 | pstack is installed from the `backnotprop/pstack` mirror at commit `fad8d01`, not from Cursor's `cursor/plugins/pstack` copy. | The mirror adds harness-neutral rewrites that let pstack run outside Cursor. Without them the skills assume Cursor tools and paths. | `MIRROR.md:1-8` (mirror is `cursor/plugins/pstack` plus harness-neutral rewrites); `README.md:32-38` (documented `npx skills add backnotprop/pstack` install) | Todd, 25 Oct 2026 |
| 2 | The Mastra Code adapter is Julia's own (`docs/harness/mastra-code.md`), not a file shipped by pstack or Mastra. | pstack's Harness section maps Cursor names to Claude Code, Codex, Pi and OpenCode but has no Mastra Code row. Mastra Code needs its own tool ids, model fields, settings path and transcript location. | `skills/poteto-mode/SKILL.md:103-113` (Harness mappings; no Mastra Code entry) | Todd, 25 Oct 2026 |
| 3 | Formal verification is declined at setup. JUL-271 owes it. | The first setup run accepts the generated verification skill and leaves formal verification for the card that owns it. | `skills/setup-pstack/SKILL.md:82-84` (step 8 offers the formal verification skill) | Todd, 25 Oct 2026 |
