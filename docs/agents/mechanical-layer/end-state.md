# Mechanical layer

pstack decides how the work is done; the card decides what gets built. The mechanics (which model runs, a helper's step budget, which programs run, crash recovery) live in our code on stock Mastra settings, so the Lead neither guesses them nor routes around them. pstack's files stay untouched, and each rule our code enforces names its pstack anchor.

## The 7 Nov failures

In the JUL-341 Studio run:
- The Lead called helpers with `maxSteps` 18, 15 and 12; each stopped on a tool call and returned empty text.
- The Lead then ran `codex exec` on ChatGPT models through its shell, bypassing the helpers on Todd's picks.
- Studio was killed for running out of memory, and the workflow restarted the build from step 0.

## Models file

The machine's one models file is the picker's own `~/.config/julia/lead-role-models.md`. pstack's `~/.agents/pstack-models.md` stays untouched for the sessions Todd runs by hand (Codex, Claude Code, CommandCode), whose harnesses can't reach every model the picker offers (Todd, 5 and 7 Nov).

## What gets removed

- The Lead's and helpers' command-line route to Codex and other coding programs.
- The Lead's control over a helper's step count.
- The machine's reading of pstack's models file, and any second set of defaults beside `dashboard/config/roles.json`.
- The Studio restart after every pick.
- Builds editing the folder Studio runs from.

## Proof per criterion

- Picked models: a real build's trace lists only picked models, `~/.codex/sessions` holds no session from that run, and a planted `codex exec` is refused.
- Picker save: Save once with a change and once with none; the models file holds Todd's choices after each.
- Next run: a run started after a save, with Studio left running, uses the new pick.
- Helpers: every helper span in the trace ends with text.
- Long build: a practice run of at least 100 Lead steps ends with Studio running.
- Resume: a Studio restart mid-build; the trace shows each earlier step once.
- Folder: `git -C ~/julia-builder status` stays clean on main through a build.
- Notifications: a forced usage-limit error reaches Todd in Linear within a minute.
- Anchors: a test PR that edits one anchored pstack line fails CI naming the rule; a test PR that adds pstack text lists it.
