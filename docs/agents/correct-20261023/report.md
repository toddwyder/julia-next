# Correct, 23 October 2026

One repeated class is fixed. Agent entry points could direct the next agent to a removed directory or heading while documentation tests passed. The new check reads the destinations instead of requiring a remembered path string.

| Past mistake | Evidence | Result with the new check |
| --- | --- | --- |
| The short rulebook removed a heading that CLAUDE.md still linked to. | `dbfb57267f4e3ddee03d97ea27fb01f27025aba7`, later included in PR #314. | Exit 1 names CLAUDE.md:24 and the removed heading. |
| Moving framework tests left AGENTS.md pointing to framework/. | `d87e80c8d15bcc98b2abbcd51dd82aa145ff5298`, PR #314. PR #315 fixed the directory text. | Exit 1 names AGENTS.md:8 and the missing directory, as well as the still-broken heading link. |
| The directory-only correction left the heading link broken. | `a451f738873d8cedcf84d43a7fa359f3d27269db`, PR #315. | Exit 1 still names CLAUDE.md:24. |

The implementation is a deterministic source check. It checks inline Markdown links, their heading fragments, and slash-containing repository file and directory paths in AGENTS.md, CLAUDE.md and CODING_STANDARDS.md. Errors name the source line and repair. CI runs exactly `node scripts/check-agent-links.mjs`. The existing test-owner discovery also runs its CLI regression tests. The stale heading link now points to Work. Root glossary references are now actual Markdown links, so their destinations are checked too. The test that required the learning-directory spelling has been removed because the new check validates its destination.

This would block a directory move without updating these instructions, a removed heading still linked from these instructions, or a newly mistyped slash-containing source path. It does not check external URL availability, installed node_modules documentation, template paths, unlinked bare root filenames, historical reports or the entire skill catalog. It is a check of the entry points' existing link and path conventions, not a general Markdown renderer.

Architecture was considered first. Generating all instruction prose from one file would not stop referenced directories or headings moving. The destination belongs to its actual file or directory, so checking that artifact is the useful boundary. JavaScript types cannot establish a separate Markdown file's headings or filesystem existence. The rule table in AGENTS.md names the executable enforcement.

## Proof

- [Current-tree red](evidence/current-red.txt) shows the new regression failing on the real remaining CLAUDE.md error before its correction.
- [Current-tree green](evidence/current-green.txt) shows the initial nine focused tests passing after correction. The final focused and ownership suite is retained in [local verification](evidence/local-verification.txt).
- [Historical replay](evidence/historical-red.txt) records the full commit IDs, checker SHA-256, diagnostics and exit 1 for each real historical tree. Run `node docs/agents/correct-20261023/replay.mjs` from the repository root. It exports each full committed tree, runs the candidate's checker against it, asserts the specific failure and removes the export. Historical files are not edited.

The first replay disproved the initial assumption that framework/ was already missing in dbfb572. It existed then. The retained replay correctly attributes the directory error to d87e80c, which moved it. This distinction is recorded in the decision log.

This is maker behavior proof, not independent review. This change has no Julia household journey, browser surface, provider call or delivery-machine runtime change. Browser and machine UAT are not applicable. No service is restarted and no model request is needed.

Other repeated CI discovery and dependency-environment mistakes already have structural enforcement in scripts/test-owners.mjs. The accepted concurrency and maintenance coverage gaps remain outside this change. No new restriction is added for Todd's accepted administrator, control-pass, runner-limit or deployed-code risks.

Fresh Standards and Spec reviewers reproduced missing coverage for the root glossary and non-JavaScript source extensions. The glossary references are now links and the source-path check accepts those extensions. The added CLI regression is retained [red](evidence/review-gap-red.txt) and [green](evidence/review-gap-green.txt). The final local suite passes 20 tests. [Policy checks](evidence/policy-checks.txt) pass; [framework lint](evidence/framework-lint.txt) passes with its existing absent-folder result.

## Framework map

| Job | Version and exact documentation read |
| --- | --- |
| CLI tests and filesystem destinations | Node 24.14.1, installed `node --help`; official versioned [test runner](https://nodejs.org/download/release/v24.14.1/docs/api/test.md) and [filesystem](https://nodejs.org/download/release/v24.14.1/docs/api/fs.md) pages. |
| Heading and relative-link behavior | GitHub Docs llms.txt index, then [Basic formatting syntax, section links and relative links](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax). |
| Historical export and publication | Installed Git `archive -h`, `ls-files -h`; gh 2.45.0 `pr create --help`, `pr view --help`, `pr list --help` and `api --help`. |

Node matches CI's pinned 24.14.1; Bun is 1.4.4. The new check has no third-party dependencies, version selector or automatic updater. Ordinary signed-in gh is available. The original worktree's unrelated edits remain untouched. The authorized finish is one open PR for Todd, with no merge.

Prove It Works required historical exports rather than invented broken fixtures as the main evidence. Test Behavior, Not Implementation kept assertions on CLI exit and diagnostics. Encode Lessons in Structure replaced the literal path rule with an executable destination check. Sequence Work into Verifiable Units kept this single class in one fix commit.
