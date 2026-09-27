# Factory installation patches

Todd authorized this small patch on 2026-09-27 to get JUL-183 running. Upstream:
[mastra-ai/mastra#25252](https://github.com/mastra-ai/mastra/issues/25252).

`@mastra/auth-workos` **1.6.5** returns an organization-less cookie user from
`authenticateToken` even when `getCurrentUser` resolves its single membership.
Core reauthentication then overwrites Factory's organization-enriched user.
The patch copies the existing `getCurrentUser` fallback into the cookie branch.
It preserves explicit organization selection and does not choose between multiple
memberships. No credentials, authentication checks, or tenant policies change.

Run installation as the dedicated Factory service user:

```sh
bash /path/to/julia-next/ops/factory/install.sh /var/lib/julia-factory/app
```

This uses the existing lockfile; it does not upgrade dependencies. The patch
checks version and original SHA-256 and rejects unexpected files. It applies
before build and checks the copied deployment dependency afterward. Repeat
application is safe. Restart the service only after checks succeed.

For an existing install, apply the patch and run its regression against both app
and `.mastra/output`; then restart. The initial unpatched regression failed with
`undefined` instead of `org_fixture`. The fixture replaces only external WorkOS
responses and exercises the real provider's public authentication method.

Removal: once an upstream version fixes this cookie path, review that version,
remove this patch and installer calls, reinstall from the approved lockfile,
then run the regression and a fresh authenticated Factory session. Do not merely
remove the files from an installation: `npm ci` restores clean package contents.

Runtime evidence and further small fixes belong on JUL-183 and in this directory.

Factory **0.17.2** also scans both `.claude/skills` and `.agents/skills` as local
sources and rejects duplicate names. Julia mirrors those skills. A second pinned
patch removes `.claude/skills` from this deployment's project discovery roots;
`.agents/skills` is canonical. It does not delete or change the mirrored files.
Remove that patch when Factory supports selecting a project skill root or
deduplicates identical mirrored definitions. The original `workspace.js` hash
is checked just as for the identity patch. Real-session invocation is the proof.

The Factory app's `postinstall` script is
`python3 /var/lib/julia-factory/patches/apply-install-patches.py .`; this keeps a
plain `npm ci` from silently losing the patches. Copy this directory to that
protected deployment path before installing. The wrapper remains the complete
install/build/check procedure.

The installer also registers one supported `defineBoard` extension, `julia-trial`,
and enables the documented `sandboxStart: 'eager'` option. The board's transition
policy reads a controller-owned evidence manifest at
`/var/lib/julia-factory/evidence/jul183/manifest.json`. Workers cannot write that
directory. A proof must match the candidate SHA and the artifact hash before
advancement; RED is tied to its baseline. Reviews and UAT have additional proof
requirements. This is a single-card trial gate, not a general delivery engine.

The regression drives the actual installed `FactoryTransitionService` with real
isolated libSQL storage. It proves rejection for absent and wrong-commit proof,
and acceptance for valid proof. Fixture cards exist only in the temporary test DB.
Removal: remove the two supported constructor options/import and this board's
files after moving any active trial card back to an installed board.
