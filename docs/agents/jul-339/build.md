# Lead in Studio

This build covers JUL-339. Shipping is a separate step. No Shipping verdict or rerun is claimed here.

## Design decision

Keep the existing plain Agent, its `flow-build` identity, and its `build` registration key. Studio displays its new name, Lead. Read the complete repository poteto-mode file when creating the Agent.

The Lead owns one model setting beside the pstack settings. The coder keeps its existing role setting. A separate installer creates the Lead file without replacing an existing choice.

The card's 5 November 2026 Agent notes choose `openai/gpt-6.1-sol` as the initial Lead model. The installer writes that value to `~/.agents/lead-model`. A missing file uses the same default. An invalid setting fails explicitly instead of changing providers. Restart Studio after changing the file.

The installed `mastracode` 0.49.0 package has no public `providers/openai-codex` export. Its `@mastra/code-sdk` 1.18.0 package exports the stock provider at `@mastra/code-sdk/providers/openai-codex`. The provider accepts a bare model ID and supplies ChatGPT OAuth authentication through Mastra Code's AuthStorage. The repository pins that version and permits only that provider import through its workflow guard.

A model resolver that reads the setting on each invocation would allow changes without restarting Studio. Creation-time loading meets this card and keeps the existing Agent configuration. An adapter outside the workflow folder would hide the provider dependency from the guard, so the exception belongs in the guard itself.

Mastra's dev server changes its working directory and reports a project path inside `.mastra`. Lead finds the ancestor containing the repository skill rather than treating either generated directory as the repository. An explicit `FLOW_REPO` still takes precedence. The live acceptance check removes that override to exercise the documented default startup.

## Build checkpoint

1. Confirm the installed provider export and Agent compatibility before implementation.
2. Give Agent configuration and Studio acceptance checks separate owners.
3. Serialize package edits. Keep the two owners' source files separate.
4. Deliver one card and one pull request. The model picker, routing, and subsequent stages stay outside this build.

The configured DeepSeek model was unavailable in this harness. Both design reviews and the implementation ran on the inherited model. The cross-company design judge did not run.

## Principles applied

Model the Domain places the independent model setting behind one reader. Laziness Protocol keeps the existing Agent and registration. Build the Lever produces the saved acceptance script. Prove It Works requires a real Studio inference and its recorded trace.

## Re-run the acceptance checks

Install the locked dependencies with `npm ci`. Use the same Mastra Code ChatGPT login as Studio. Run these commands from the repository root.

| Criterion | Re-runnable check | Build result |
| --- | --- | --- |
| Studio lists Lead and each run starts with the full poteto-mode instructions. | `npm run check:lead -- /tmp/lead-check.json` | PASS. The check reads Studio's agent list, compares the entire instruction string with the skill file, and finds that exact string in the new run's Studio trace. |
| Lead uses its own model setting through the ChatGPT subscription and the trace names that model. | `node --test machine/flow/agents.test.mjs` and `npm run check:lead -- /tmp/lead-check.json` | PASS. Setting changes affect new Agent instances. The live Studio inference uses the stock OAuth provider with API-key and base-URL overrides removed. Its trace names the selected model. |
| The PR carries a check for each criterion and Shipping reruns them with the same result. | Run both commands above from the PR head and compare the check results in `/tmp/lead-check.json` with [the build result](lead-check.json). Run `npm run guard:flow` as well. | Build checks are present and passed. Shipping's independent rerun is pending. Trace IDs, run IDs, usage, and cost can differ between runs. |

The live check boots a temporary Studio server and makes one harmless inference with tools disabled. It starts no workflow or card and stops its server after the check. Its saved result contains instruction hashes, model names, usage, and trace identifiers. It contains no credentials or raw prompts. The temporary trace database is removed with the server's scratch directory, so use the check's Studio trace API assertions as the repeatable proof.

The host's `~/.agents` directory is read-only in this build environment. Running `node scripts/install-lead-model.mjs` here returned `EROFS`. The exclusive-create installer passed its temporary-directory tests; the live check used the checked-in default. Run the installer on the writable Studio host during the separate Shipping step.

The existing workflow and trace regression tests passed, as did the setting tests, dependency guard tests, Studio run-form tests, program-list tests, agent-link check, and skill-name check.
