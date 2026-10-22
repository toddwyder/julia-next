# JUL-251 independent candidate review

Review-only subagent. All roles inherit the parent's signed-in $0 trial model. This review makes no different-maker or different-model claim. No real model requests were made.

## Findings

1. Critical. Nonzero provider readback does not stop subsequent free requests. In the reviewed transport, STOP WORK creates an unknown reservation with maximumNano=0. CardLedger blocks only positive reservations, leaving pricedBlocked=false. I ran createTransport with the real CardLedger and a synthetic upstream returning usage.cost=0.01. Two consecutive requests both reached upstream. The receipt showed two unknown rows and spentNano=0, heldNano=0, pricedBlocked=false. A durable stop latch must block every later dispatch and survive reopening. The parent was notified before its ledger changes began.

2. Critical. Builder home symlinks grant access to credential files. The launcher grants all filesystem rights to both workspace and home. Home is workspace/.builder-home, accepted without canonical containment and resolved by Landlock when its path is opened. A preexisting .builder-home symlink to the external state directory makes that private directory an allowed root. I booted the actual adapter and ran runner.execute('cat .builder-home/auth.json'). It returned a synthetic sign-in secret. A builder can also replace the home directory with a symlink after boot, making startup-only checks insufficient. Remove the duplicate home grant because the workspace already includes a valid home, and validate the selected home. Reproduction is /tmp/jul251-home-probe.mjs.

3. High. State containment checks are lexical. An outside-state symlink into workspace/private-state passes relative(cwd,stateDir), and the stock AuthStorage file consequently becomes builder-readable. I booted the adapter with that arrangement and runner.execute('cat private-state/auth.json') returned the synthetic sign-in secret. Resolve existing state and auth paths including symlinked parents before containment checks. Reproduction is /tmp/jul251-symlink-probe.mjs.

4. High. Known paid usage above the reservation is discarded. The transport computes costNano, then throws before ledger.settle when costNano exceeds spec.maximumNano. Its catch changes the row to unknown and discards the received usage. A synthetic valid response with prompt_tokens=101 and completion_tokens=10 against maxInputTokens=100/maxOutputTokens=10 and $1/M input/output rates produced spentNano=0, heldNano=110000 and usage=null despite known actual costNano=111000. Ledger.settle already has an accounting_failure state for this case. Record actual usage and cost, retain the block, and refuse the response. This keeps the durable total truthful after a provider-bound violation.

## Comment Sicko pass

Yes... Ha ha ha... Yes!

Scope was adapter.mjs, command-boundary.py, ledger.mjs, transport.mjs, settings.json and test/*.mjs. There are no comments, suppression directives, or commented-out code in this scope. Touched files none. Deletions 0. MUST KILL flags none. Restorations 0. Reruns 0. Architect sketch unnecessary. Encoding offers none. Unenforced comment constraints none. Skips none.

## Other reviewed requirements

The adapter maps the configured opening role through settings, installs fetch before importing SDK modules, preserves original runtimeProvider credentials outside saved settings, and routes builder execution through the wrapped stock workspace sandbox. Settings-driven role selection and free-model zero accounting are visible in source and existing tests. The existing test suite's two direct requests do not by themselves demonstrate SDK retries. Parent is adding actual stock Auto observation/reflection/recall proof; this reviewer does not claim that proof passed.
