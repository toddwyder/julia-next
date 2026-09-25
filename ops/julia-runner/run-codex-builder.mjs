// The Codex builder uses the same bounded, contained launcher as the reviewer,
// with a distinct fixed sudo command and process name for the graph's live
// worker check. It may write only to its selected card worktree.
import { main } from './run-reviewer.mjs';

main('builder');
