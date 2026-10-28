# Poteto's inverse pyramid — how we fix every correction

Source: poteto (Lauren Tan), X post, as given by Todd (21 and 23 Oct 2026). Todd's standing rule: every correction to an agent is fixed as high in this pyramid as it will go. Most effort at the top, least at the bottom.

> how do you trust your agents' work more?
>
> 1. **codebase improvements**: this is just good software engineering - better architecture, stronger types and invariants, clear boundaries. agents love to copy what exists and take the shortest path, so make the easy thing the right thing. categorically eliminate problems through code and you won't need to think about it again.
> 2. **static analysis**: lint rules, tests, CI, verification (eg TLA+). very token efficient ways to catch issues ahead of time.
> 3. **prose**: comments, rules, AGENTS.md, skills - anything that can't be enforced and requires agent judgment. use it minimally, but do use /create-verification-skill.
> 4. **human review**: the hardest to scale. at the rate agents land code, it's pretty much impossible to thoroughly review every PR, so spend that effort on the highest leverage point, designing an environment where agents do the right thing by default.
>
> this forms an inverse pyramid: you want most of your effort at the top, least at the bottom. codebase improvements are deterministic, making it more token efficient, and lets you sleep more soundly at night.

In pstack, `/correct` is this pyramid as a working procedure, and `principle-encode-lessons-in-structure` is its rule ("the instruction is the symptom").
Also referenced in `vision/hybrid-agentic-pipeline-strawman.md` (section 2).
