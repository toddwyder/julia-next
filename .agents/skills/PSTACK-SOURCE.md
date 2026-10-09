# Pstack verification skills

Installed for JUL-203 from https://github.com/backnotprop/pstack at
`3a604672c46cd8187d2b19980eae0a34f9f91138` (immutable source).
Copyright (c) 2026 Lauren Tan; MIT license retained verbatim in
[PSTACK-LICENSE.txt](PSTACK-LICENSE.txt).

Only the four named skills below and the generator's three referenced feature-map
examples are included. Each file is an unmodified upstream Git blob: names,
frontmatter, bodies, workflows, and references are preserved. No other Pstack
skill, hook, controller, or setup system is installed. Generation and maintenance
have not been invoked. The canonical source is `.agents/skills`; explicit readers
must use that path rather than maintaining another copy.

## Comparison with the pinned source

Clone the source, checkout the revision above, and compare `git hash-object
.agents/<upstream-path>` in this repository to `git rev-parse HEAD:<upstream-path>`
in the source checkout. The expected Git blob IDs and SHA-256 byte hashes follow.

| Installed path | Git blob | SHA-256 |
| --- | --- | --- |
| `.agents/skills/create-verification-skill/SKILL.md` | `fa220132325d82519762114425151fc1e091e206` | `dce6a835a30a6547cab3fa742ea94c2487c947349f0289fbe3a312c539761bf5` |
| `.agents/skills/create-verification-skill/references/feature-map-example/README.md` | `fb64570cfab3bbe672fe80925651933ebd57aa33` | `cb7bd782cf89968a4ba3d58a5151db837430db92d19a6f52a906973b77b516ba` |
| `.agents/skills/create-verification-skill/references/feature-map-example/create-note.md` | `21357566b69223a503d6780a04fb90ce540eae22` | `644a44c74f35d38c2feb7cd05a0121fdebbb623e8dc376c185b565a581d1ccf7` |
| `.agents/skills/create-verification-skill/references/feature-map-example/search.md` | `1f8e57d3aaf19cf27a9464d55fa72e46bcbc8b0f` | `6e87b9e7f2791a7776ba1bb83f371cd285c306c67f19d245cc4dd6ca3015c823` |
| `.agents/skills/maintain-verification-skill/SKILL.md` | `f2a3cdc24b6882b12d634528ca13b917b66259f0` | `5943f7747da6aafcf5c1063c988e725c97e415866f5c7746279012f35cb49815` |
| `.agents/skills/principle-prove-it-works/SKILL.md` | `5dc14a3b06f9d579e5c17cd8a7242f432ddb3125` | `ec79a15025bac8d33d62011c54f3b612733fd2a024e623b531b3637aa75070e2` |
| `.agents/skills/principle-test-behavior-not-implementation/SKILL.md` | `42de6f8f7cab01b9f67aa28bd59b128f7574fbab` | `87e40efe4e486f7ea639d2ed1fc0abe6c93b8fd0e89a81218086909d2470a52e` |

License upstream path: `LICENSE`; Git blob `6b5400237fdf6545be0b8fae370d6f2fcff8fb25`; SHA-256 `bc957ca6bee02792566a1a028d105e02e247c6e77cf057061674273da77b200e`.
