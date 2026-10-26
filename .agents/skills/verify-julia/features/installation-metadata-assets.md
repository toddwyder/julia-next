# Julia install manifest and icons

The home page links to a manifest on the same site. The manifest describes Julia as a standalone app and lists two PNG icons that a browser can load.

## Sub-features

- `install-manifest-link`: the home page has a `link[rel=manifest]` on the same origin.
- `install-manifest-content`: the manifest says `name` and `short_name` `Julia`, `start_url` and `scope` `/`, `display` `standalone`.
- `install-icon-192` and `install-icon-512`: both icons return `image/png` and decode at 192×192 and 512×512.
- `install-favicon`: the page has at least one `link[rel=icon]`.

## How to get to it (user POV)

- Open `$RUN_URL`. The browser reads the manifest link and the icons itself; the user sees them as the tab icon and the "Install" or "Add to Home Screen" choice.
- This recipe checks what the browser receives. It does not prove that installing on a phone works.

## Driving it with Playwright CLI

Preconditions: the steps in [README.md](README.md#before-any-feature) are done and the browser is open at `$RUN_URL`.

- **Read the links.** Run `pw --raw eval "JSON.stringify({origin: location.origin, manifest: document.querySelector('link[rel=manifest]')?.href, favicons: document.querySelectorAll('link[rel=icon]').length})" > "$EVIDENCE/manifest-entry.json"`. The manifest URL starts with `origin` and `favicons` is at least 1.
- **Fetch the manifest and decode the icons in the page.** Run:

  ```bash
  pw --raw eval "(async () => { const url = new URL(document.querySelector('link[rel=manifest]').href); const r = await fetch(url); const manifest = await r.json(); const icons = await Promise.all(manifest.icons.map(async i => { const u = new URL(i.src, url); const ir = await fetch(u); const b = await createImageBitmap(await ir.blob()); return { url: u.href, status: ir.status, type: ir.headers.get('content-type'), width: b.width, height: b.height }; })); return JSON.stringify({ status: r.status, type: r.headers.get('content-type'), manifest, icons }); })()" > "$EVIDENCE/manifest-assets.json"
  ```

  The file shows status 200, a type containing `application/manifest+json`, the manifest values listed above, and two icons with status 200, type `image/png` and sizes 192×192 and 512×512.
- **Saved spec.** Run `node .agents/skills/verify-julia/verify-julia.mjs test .agents/skills/verify-julia/tests/install.spec.mjs`. It must end with `exitCode=0`.
- **Side effects.** None. Record `not applicable`.

## Gotchas

- Read the manifest URL from the page's link, not a hard-coded `/manifest.webmanifest`. A hard-coded path would miss a broken or cross-origin link.
- The declared size and type are not enough. The icon must decode at the right size in the browser.
- Passing here does not prove that installing on a phone works. Say so in the report.
