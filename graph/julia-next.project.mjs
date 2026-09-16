// julia-next.project.mjs -- the declarative project config the
// julia-coordinator skill (.claude/skills/julia-coordinator/SKILL.md) reads
// for its target repo, tracker, and gate check.
//
// This lives inside julia-next's own graph/ directory -- a path the trusted
// publisher's PROTECTED_WORKER_PATHS convention (established in
// toddwyder/Julia) reserves as coordinator-owned, not worker-editable.
//
// tracker: 'linear' is a smaller shape than the native GitHub-Project-board
// configs used by toddwyder/Julia: no project board number, work graph, or
// field mapping, because none of that exists for julia-next yet.
//
// Checked, not assumed (2026-09-16): the AI-Stack orchestrator functions
// this file's earlier comment claimed as its consumer
// (prepare-julia-supervised-run.mjs, publish-julia-supervised-run.mjs,
// --project-config) do not exist on toddwyder/AI-Stack's real main branch --
// only in a throwaway local clone from an earlier session. The
// julia-coordinator skill does not depend on them; it dispatches directly
// through scripts/orca-cli.mjs and publishes through
// scripts/publish-via-github-app.mjs. This config stays in the AI-Stack
// project-config shape in case that integration is built for real later,
// but nothing in this repo currently requires it.
export default {
  id: 'julia-next',
  tracker: 'linear',
  targetRepo: { owner: 'toddwyder', name: 'julia-next' },
  gate: {
    repo: { owner: 'toddwyder', name: 'julia-next' },
    checkName: 'checks',
  },
  linear: { teamKey: 'JUL' },
};
