# Notes on the hybrid pipeline straw man (22 Oct 2026)

Status: parked. Machine first. Revisit when a snag suggests changing how work runs.

Fits:
- Inverted pyramid matches 22 Oct lessons: prose fixes recurred; structural fixes held (runner-adapter spend cap, builder never sees keys, framework-fact tests without a model).
- Pocock = what to build; pstack = build and prove. Close to the current pre-plan / build split.

Tensions to settle before adopting:
- Skill overlap: brief disables Pocock tdd/code-review; the repo uses both today.
- Spend: pstack swarms and multi-model review panels multiply paid calls; they must run under the runner's per-card cap.
- Model routing: brief routes by tier; Todd's dated model decisions must win.
- Ticket home: brief uses disk tickets; Julia uses Linear cards.

Accuracy check before hardening: the pstack pack (cursor/plugins, checked 22 Oct) has `unslop`, not `deslop`; no separate CI-babysitting skill was seen. Verify every named skill against the real pack.
