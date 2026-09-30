# Issue #163 — Make Julia installable on Todd's phone

## Goal

On Todd's Pixel 8, Chrome can install the HTTPS Julia rehearsal copy as **Julia** with a placeholder icon; its home-screen launch shows the existing Julia/version/welcome home page without the browser address bar. After accepted release, the permanent Real Julia origin independently serves the same install metadata and icons. Do not call this done based on desktop tests alone: Todd must perform the specified phone UAT and the accepted release must pass a separate permanent-origin check.

## Scope

In: a same-origin Next.js web app manifest, PNG icons, browser-visible install metadata checks, preview and production-origin verification. Preserve the existing home page. Out: offline support, service worker, data, other screens, look and feel, Factory/publisher changes, and a manual product merge.

## Framework map and alternatives

Need → built-in feature → official documentation:

- Route the manifest → Next.js App Router `app/manifest.webmanifest` metadata-file convention → https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest
- Expose installed app icons → Next.js file-based `app/icon.png` / `app/icon1.png` metadata convention → https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons
- Chrome Android menu installation → same-origin manifest with name, start URL, standalone display, 192px and 512px PNG icons; no fetch-handler service worker required for menu installation → https://web.dev/articles/add-manifest and https://developer.chrome.com/blog/update-install-criteria

Framework map posted on issue #163. Checked and rejected: custom manifest route/static headers (framework already supplies the file convention), service worker (offline is out of scope and not required to install from the menu), fullscreen display (hides phone status bar), hand-built installer/progress telemetry (unnecessary for browser metadata), and changing home text (already covered). Use PNGs with a simple visible Julia placeholder; no new image library or build-time generator. Do not hard-code preview or production hostnames: `start_url`, `scope`, icon sources and optional manifest `id` are origin-relative so each origin remains its own installation.

## Phases

### 0. Record scoped authorization and retain the release hold

- Todd removed #163's draft-start hold and explicitly authorized Factory to plan, build, review and prepare a phone preview while #139 is unfinished. This waives the wait-before-building condition only. Proceed through the ordinary Factory lifecycle; do not change Factory machinery, publisher permissions or Vercel protection to obtain a preview.
- #139 still has no proven enforceable UAT-to-merge route. Before any merge or release, require a separately approved, specific release path that binds Todd's Pixel UAT acceptance to the reviewed and tested head. Do not ask Todd to review or merge a PR; do not merge #163 simply because tests, reviews or UAT pass. Record new gate findings on #139. Recheck #163's instructions and #139's status at the handoff; if the release path remains unapproved, stop after review/preview and leave the product unmerged.

### 1. Implement and test browser install metadata (scoped authorization granted)

- At the public browser boundary add one Playwright test to `e2e/home.spec.mjs`: navigate `/`, inspect the emitted `<link rel="manifest">`, request its URL, assert a successful manifest response and `name`/`short_name` `Julia`, origin-relative `start_url` `/`, `scope` `/`, `display` `standalone`, and two PNG icon declarations with sizes 192x192 and 512x512. Resolve each URL against the page origin; assert success, image Content-Type and decodable natural dimensions. Assert the page advertises an icon. Run this test before edits: expect red because there is no manifest link.
- Make just this test green: add `app/manifest.webmanifest` with the above fields (use `id: '/'` if supported by Chrome; no fixed host), and static `app/icon.png` and `app/icon1.png`, one at each specified dimension, following Next's file metadata convention. Point manifest `icons[].src` to the URLs actually exposed by Next for these files; verify the URL and Content-Type against the running application rather than assuming emitted icon URLs. Keep `app/layout.jsx` and `app/page.jsx` unchanged unless a browser-visible assertion demonstrates a necessary adjustment. If file-based icon URLs cannot be referenced stably from manifest, instead put the two static PNGs under `public/icons/` with explicit root-relative `src` values and set `metadata.icons` in the existing `app/layout.jsx`; do not add a custom endpoint.
- Run `npx playwright test e2e/home.spec.mjs`, `npm run build`, `npm run lint:framework` and the full repository test suite per `.github/workflows/ci.yml`; install dependencies from `package-lock.json` first with `npm ci`. The existing home-copy test must remain green. No TypeScript source is touched; run `npx tsc --noEmit` only if TypeScript is installed/configured by this checkout.

### 2. Rehearsal, UAT and permanent-origin follow-through

- On the HTTPS rehearsal deployment for the exact reviewed commit, fetch the manifest and both icon URLs from a phone-accessible preview origin and inspect responses/size. If Vercel Standard Protection sends Chrome to sign-in, request the authorized preview-access decision; never silently disable protection or claim UAT success. CI and desktop Playwright do **not** assert Chrome's install-menu behavior.
- Todd opens the preview link in Chrome on his Pixel 8, selects **Install app** in Chrome's menu, confirms home-screen **Julia** and placeholder icon, relaunches without browser address bar (phone status bar may remain), and verifies `Julia`, the current repository version and `what are we cooking today?`. Record this evidence against the exact candidate. The preview home-screen app stays tied to its temporary origin; it is not the permanent installation.
- Only after Todd's phone UAT **and** approval of a specific release path for the exact reviewed/tested candidate may release proceed. #139 being unfinished does not authorize a merge. After accepted release through that path, request the same manifest/icons from Real Julia's permanent HTTPS address and confirm the start/identity/icon URLs resolve on that origin. Todd can separately install the permanent app there; do not treat the preview install as that proof. If the release path, preview access, UAT or permanent-origin check fails, leave the relevant acceptance criterion open and report the blocker; no manual merge.

## Seams and tests

Read `.claude/skills/tdd/SKILL.md` before implementing. The confirmed seam is the browser-visible homepage + HTTP manifest/icon responses, observed through the existing Playwright e2e harness (`playwright.config.mjs`). First test: `home page exposes an installable Julia manifest and decodable icons`; prove **red** before adding metadata, then add only the manifest and image assets needed for **green**. Do not mock Next internals, inspect source filenames in the test, or write all tests ahead of implementation. Existing `home page shows Julia, the application version, and a welcome line` already covers the exact welcome copy; no duplicate test or rewrite. A physical Pixel 8 Chrome install and launch is the second, manual seam because desktop Chromium cannot establish Android menu/home-screen behavior.

## Observability

The committed Playwright HTTP assertions permanently measure manifest presence, status, content type, fields and both icon dimensions, and report which URL failed in CI. Built-in Next/Vercel request/deployment logs provide origin-level evidence of manifest/icon requests and non-200/redirect responses; rely on these rather than adding an instrumentation route or speculative production logging for static files. Record phone-menu/home-screen results and the reviewed deployment URL/head in the card's UAT evidence; no hand-built progress file.

## Risks

- Chrome may offer a shortcut rather than an installed standalone app if metadata or PNG dimensions fail: catch with icon decode/status test and actual Pixel 8 menu/relaunch.
- Next may emit hashed/icon-query URLs: observe browser-emitted routes and confirm manifest icon `src` URLs are valid in `npm run build` and deployment, fall back to static `public/icons/` if necessary.
- Preview deployment protection may prevent unauthenticated phone access: check before Todd's UAT and seek authorization, not a silent configuration change.
- A preview and production install are distinct origins; test production metadata after release. Browser caching can mask an update: inspect the fetched manifest/icon URLs and candidate revision.
- #139's unresolved merge gate blocks release, not planning, building, reviewing or preparation of the phone preview; Todd authorized that scoped waiver. Never substitute PR approval, manual merge or a Factory machinery change for the separately approved, specific release path.

## Assumptions

- Rechecked current `app/page.jsx`: the existing `Julia {version}` and exact welcome copy already satisfy the text requirement; `e2e/home.spec.mjs` covers them. Preserve both.
- Rechecked `app/layout.jsx`: it only sets title `Julia`; there is no manifest or icon in this checkout. The repository is shallow; `git log` on affected files exposes only the current snapshot. PR #130 introduced the existing home/version e2e pattern, not an install implementation; no earlier install PR was found.
- Choose Next metadata-file conventions and static PNGs before any custom route, service worker or runtime icon generator; switch to `public/icons/` only if tests demonstrate Next metadata-file URLs cannot safely serve manifest icons.
- Choose root-relative `id`/start/scope/icon URLs to keep temporary and permanent origins separate; do not embed a deployment hostname in install metadata.
- Todd edited #163 to remove its draft-start hold and instructed Factory to proceed through planning, building, review and phone-preview preparation despite unfinished #139. This is a scoped build authorization, not a release authorization. #139's latest report still finds no safe UAT-to-merge path; no product merge without a separately approved, specific release path.
- Existing Vercel Standard Protection and the GitHub-hosted CI billing limitation described in `docs/agents/factory-platform-auth-change-log.md` must be checked again at rehearsal; neither should be worked around as part of this feature.

## Open questions

- Todd authorized work through the phone-preview stage; no further draft-start approval is required. Only Todd can approve a specific release path if #139 remains unfinished; this build authorization grants no merge exception.
- If the current protection blocks phone rehearsal, Todd/authorized operator must decide how the exact preview is made accessible; do not relax project-wide protection without authorization.
