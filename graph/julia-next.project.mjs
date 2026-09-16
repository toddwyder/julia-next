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
    // Matches the env var name julia-next-supervised-worker-manual.yml
    // (AI-Stack) sets from steps.publisher_token(.outputs.token) before
    // calling publish-julia-supervised-run.mjs -- same convention as the
    // existing toddwyder/Julia workflow, not a julia-next-specific name.
    // requirePublisherCredential(config) reads exactly this var.
    credentialEnvVar: 'JULIA_GRAPH_WRITE_TOKEN',
  },
};
