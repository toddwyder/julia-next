// julia-next.project.mjs -- the project config for JUL-43's supervised graph
// run, loaded by AI-Stack's orchestrator/prepare-julia-supervised-run.mjs
// and orchestrator/publish-julia-supervised-run.mjs via --project-config.
//
// This lives inside julia-next's own graph/ directory -- a path the trusted
// publisher's PROTECTED_WORKER_PATHS already refuses to let a credential-
// free worker touch (orchestrator/lib/julia-supervised-publisher.mjs).
//
// tracker: 'linear' is a smaller shape than the native GitHub-Project-board
// configs used by toddwyder/Julia and toddwyder/AI-Stack: no project board
// number, work graph, or field mapping, because none of that exists for
// julia-next yet. See orchestrator/lib/project-config.mjs for what each
// tracker value requires and forbids.
export default {
  id: 'julia-next',
  tracker: 'linear',
  targetRepo: { owner: 'toddwyder', name: 'julia-next' },
  gate: {
    repo: { owner: 'toddwyder', name: 'julia-next' },
    checkName: 'checks',
  },
  linear: { teamKey: 'JUL' },
  handoff: {
    // Used only by AI-Stack's generic publish-julia-supervised-run.mjs CLI
    // (the manual --mode finish recovery path in the runbook), which reads
    // this env var directly -- so that path still needs it exported by
    // hand. scripts/run-jul43-coordinator.mjs -- the real initialization
    // command -- does not read this var at all: it mints a fresh ~1-hour
    // installation token itself, per run, from JULIA_PUBLISHER_APP_ID /
    // JULIA_PUBLISHER_APP_PRIVATE_KEY (scripts/publish-via-github-app.mjs,
    // reused from toddwyder/Julia's Round B1) and uses it directly.
    credentialEnvVar: 'JULIA_NEXT_GRAPH_WRITE_TOKEN',
  },
};
