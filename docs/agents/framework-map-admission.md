# Framework Map admission

Admission reads the Linear description and every page of issue comments, using queries only.
The pre-plan Framework Map is a separate comment. A record has a Framework Map heading
(or begins with that label), or links a repository map. Incidental mentions are not records.
Admission selects the newest record by Linear's `createdAt`; if dates are unavailable it
checks every candidate record rather than guessing supersession. A description or comment can instead link a
`docs/...framework-map.md` file; admission reads that path in the launcher's checkout. A GitHub
blob link supplies the repository path, not a remote revision: use the intended candidate checkout.
No map is inferred from a card identifier. Existing cards without a map reference retain their
existing section checks; the pre-plan instruction requires an available map.

The shared `CardAdmissionSchema` and `ReadyCardSchema` enforce the same rules for pre-plan,
launcher intake and Ready-card discovery. Findings fail only that card and identify the job,
missing installed file or absent quoted section. The check never edits Linear.

Maps may use table rows, Markdown bullets, or prose. Installed citations use backticks around a package
path (including `package@version/path:lines`) or a plain `node_modules/...` path. Package paths
resolve in the reviewer's installed node_modules; repository-prefixed paths resolve in the checkout.
Windows separators are normalized. Bare `node_modules/` citations use the checkout's root installation
first, then the reviewer's installation. Bare repository/evidence paths resolve in the checkout
or relative to `docs/agents` before npm resolution. Unqualified CLI suffixes such as
`dist/bundled/...` are not npm locators: use a package-qualified or explicit node_modules path
for an installed-file check; the checker does not guess global CLI installation directories.
Quoted section text must occur in that file (case-insensitive literal text, rather than a
Markdown-heading parser). Leading quotes in the documentation cell belong to its first citation;
subsequent quotes belong to the preceding citation. Missing files, including unavailable
installed dependencies, fail closed. Private provider files/formats and explicit Framework gap or
no published page claims require a link labelled `Todd decision` on the affected job, pointing to
the dated decision in Linear or this repository on GitHub. This is a required decision-reference
check; it does not authenticate the linked author's identity or infer approval from comment authorship.
Generic documentation is no exception.

## Documentation read

| Need | Feature | Exact documentation |
| --- | --- | --- |
| Read all comments without changing cards | Existing Linear GraphQL queries and cursor pagination | https://linear.app/developers/graphql ; https://linear.app/developers/pagination |
| Return shared admission findings | Zod 4.6.5 `superRefine` | https://zod.dev/api#superrefine |
| Inspect installed documentation | Node 24.14.1 `readFileSync`, `realpathSync`, path resolution | https://nodejs.org/docs/v24.14.1/api/fs.html#fsreadfilesyncpath-options ; https://nodejs.org/docs/v24.14.1/api/path.html#pathresolvepaths |
| Exercise the existing admission seam | Node test runner and assertions | https://nodejs.org/docs/v24.14.1/api/test.html ; https://nodejs.org/docs/v24.14.1/api/assert.html |
| Publish and merge through signed-in GitHub | Authenticated GitHub connector, Git trees/commits/refs and PR API | https://docs.github.com/en/rest/git/trees#create-a-tree ; https://docs.github.com/en/rest/git/commits#create-a-commit ; https://docs.github.com/en/rest/git/refs#update-a-reference ; https://docs.github.com/en/rest/pulls/pulls#create-a-pull-request ; https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request |
| Check framework lint | Installed ESLint README and CLI | `node_modules/eslint/README.md`, `npx eslint --help` |

Free CI already covers `test/card-admission-check.test.mjs`: reviewer paths select
`julia-init-windows`, which runs `npm ci` at the root and in the reviewer before
`scripts/julia-runner-suite.mjs`. Its discovery includes this test. No provider call or paid review
is needed. Todd's 20 October 2026 light-path choice supplies proof: replay the map from
8368117fe7d2f25d0280deb1a8fa7727acfca467 (refuse) and main c2b25a193d73917245f8daf18e4f4e7399a66442
(pass), not PR #301's later head. The exact rejected map is retained in the existing fixture module.
