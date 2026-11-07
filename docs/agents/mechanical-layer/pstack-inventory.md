# pstack rules this card enforces

An **anchor** is the exact pstack phrase a rule comes from. Each is unique in its file.

| Rule | Source | Anchor | Enforced by |
| --- | --- | --- | --- |
| Each role runs on its explicit model. | `.agents/skills/poteto-mode/SKILL.md:96` | explicit model per role | Command execution off or gated for the Lead and helpers. |
| Feature, bug-fix and refactor code is delegated. | `.agents/skills/poteto-mode/playbooks/feature.md:12` | Mandatory: no skip-with-reason escape | The Lead's only route to code-writing is a helper. |
| Code-writing goes to the role's helper, on its configured model. | `.agents/skills/poteto-mode/playbooks/feature.md:12` (also `bug-fix.md:9`, `refactoring.md:11`) | Delegate code-writing to a subagent using your configured feature model | Our role-to-model map (`machine/flow/role-models.mjs`); the Lead picks the role. |
| Each role has a default model. | `.agents/skills/poteto-mode/SKILL.md:96` | Defaults for every | The machine reads only the picker's `~/.config/julia/lead-role-models.md`, with defaults in `dashboard/config/roles.json`. pstack's `~/.agents/pstack-models.md` (`SKILL.md:110`) stays for hand-run sessions. |
| Helpers delegate no further. | `.agents/skills/poteto-mode/playbooks/feature.md:12` | waits on a nested agent | Helpers have no `agents` (`machine/flow/agents.mjs:38-46`). |
| Subagents are fresh per delegation. | `.agents/skills/poteto-mode/SKILL.md:102` | Fresh subagents by default. | Stock Mastra: one thread per delegation. |
| A stopped run resumes from its saved point. | `.agents/skills/poteto-mode/playbooks/pause-safely.md:8` | Write the resume note off-context. | Stock Mastra restart and recovery. |

## Update path today

- `.agents/skills/PSTACK-SOURCE.md:4-5` records the pinned commit and version; the install command pins by commit (`:14-17`); four trees are copied by hand (`:21-25`). No script performs an update.
- `scripts/check-pstack-pin.mjs` clones the pinned commit at depth 1 (`:124-129`) and compares installed files byte for byte (`:103-122`). It reads no anchors.
- The anchor check needs this table as data and a search for each anchor in its file at the pinned commit.
- The new-text check needs the previous commit fetched too, and lists lines added under each `##` heading in `SKILL.md` and `###` heading in the playbooks that no anchor covers.
