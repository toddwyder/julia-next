# Request boundary design

The public caller opens one card runner with a settings path, asks it to run a configured role, and reads a durable receipt. Only the SDK adapter imports the SDK. Model and provider names appear in settings, never core policy branches.

Candidate B is the base. Candidate A cannot cover SDK module-local routing for memory and other agents. Its durable reserved, settled and unknown request states and conservative full-context reservation reinforce B. Both candidates preserve unknown holds across restarts. The rubric scores A 0/0/2/1/2 and B 2/2/2/1/2 for stock preservation, per-attempt coverage, predispatch bounds, credential feasibility and API size. Credential isolation requires a running probe before acceptance.

The adapter installs a fetch boundary before loading the SDK. Settings map exact endpoints and wire model IDs to canonical model prices. Protocol modules normalize chat-completions, Responses and messages usage. Every wire attempt reserves before fetch. Buffered responses settle before the SDK sees success. Missing priced usage refuses that response and blocks further priced calls. Discovering missing response usage necessarily requires sending the first request; the pre-send refusal proof applies to subsequent requests.

SQLite transactions serialize the one shared card invariant. The total is derived from settled rows, with unresolved reservations retained. Money uses integer nano-dollars. Free calls reserve and add zero, even with no usage. A request reserves the configured full maximum input and enforced maximum output at worst applicable rates. Unsupported or unbounded paid protocols fail closed. The trial transport also forbids all nonzero prices, separate from the built $1 behavior.

Stock Auto memory, thresholds, buffering and local storage remain active. Custom-provider Auto follows the selected model with inherited Google credentials removed. A real memory proof must inspect observation, reflection and recall through that engine; constructor inspection alone does not pass.

Credentials enter through stock runtime sources, outside builder settings. Builder commands inherit an explicit environment and a fresh home. Stock workspace filesystem tools stay within the working directory. Bubblewrap cannot create namespaces in this harness, so test a Linux Landlock launcher as the command boundary. It restricts files for all descendant commands without privilege changes. No isolation fallback may silently expose credentials. The ubuntu administrator risk stays accepted.

The initial definition of done is all five card criteria observed through the adapter, framework tests green, new guard mutations detected, committed evidence and an open PR to main. Work does not include delivery orchestration, reviewing cards or changing household behavior.
