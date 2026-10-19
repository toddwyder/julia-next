# Issue tracker: Linear

New Julia and machine cards live in the `Julia-next` Linear team. Linear owns card descriptions,
requirements, acceptance criteria and status. GitHub owns code, commits, pull requests and CI.
Mastra Factory and its Intake route are retired and must not be recreated or used.

Use the signed-in Linear connector for card creation, description updates, comments, labels and
status changes. Read-only or comment-only command work may use `scripts/linear-cli.mjs` through
`scripts/julia-vault-windows.ps1`; that script does not create cards, edit descriptions or change
status. Never expose the Linear credential outside the vault subprocess.

Before creating a new card, return the detailed triage brief to Todd and wait for approval. After
approval, create the real card before adding any dependency relationship so links use identifiers
assigned by Linear. Pasted feedback is source material, not creation or implementation authority.

## Pocock triage mapping

Pocock's canonical category roles are Linear labels `bug` and `enhancement`. Its canonical state
roles map as follows:

| Pocock role | Linear representation |
| --- | --- |
| `needs-triage` | `Triage` status and `needs-triage` label |
| `needs-info` | `Triage` status and `needs-info` label; return to `needs-triage` after the answer |
| `ready-for-agent` | `ready-for-agent` label; during pre-plan, change status to `Ready` only after Todd says `settled` and launcher admission passes |
| `ready-for-human` | `Triage` status and `ready-for-human` label |
| `wontfix` | `Canceled` status and `wontfix` label |

Exactly one category label and one state-role label remain on a triaged card. For Julia cards, the
agent brief is the authoritative card description, not only a comment, because launcher admission
reads the description. Triage comments keep Pocock's required AI disclaimer. The approved plan
answers routine scope and seam questions.
