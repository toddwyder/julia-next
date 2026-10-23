# Blocked notification behavior proof

The notification tests were added before notification implementation on 23 October 2026 UTC. They use real child processes writing fixture markers. They do not call Linear or send a real blocked alert.

Initial command was `node --test test/observer.test.mjs` from `ops/verification-maintenance`.

The existing two observer tests passed. The two new tests failed. The first could not read `notifications.json` and returned `ENOENT`. The second expected a retained notification error and received `undefined`. The missing notification behavior was therefore observed before implementation.

After implementation, `npm test` passed all six tests. The observed behaviors were no duplicate maintenance start, one blocked notification across repeated polls, retry after failed delivery on a later no-merge poll, recovery of an already delivered Linear marker without a second comment, and the real Bubblewrap write boundary. The configured test notifier writes a local marker. The production notifier executes the stable server vault wrapper, reads the existing card's comments, and invokes the existing Linear CLI comment route.

The clean merge replay does not configure a notifier and does not send a blocked alert. Production notification configuration targets the existing JUL-251 card. The controller retains comment identity or notification error in the durable merge run.
