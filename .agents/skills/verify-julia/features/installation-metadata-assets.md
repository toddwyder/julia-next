# Julia installation metadata and assets

Julia publishes a same-origin web manifest that describes its standalone install experience and links to two decodable PNG icons.

## Sub-features

- `install-manifest-link` exposes a same-origin manifest link from the home page.
- `install-manifest-content` serves Julia's name, start URL, scope, and standalone display metadata.
- `install-icon-192` serves the manifest's 192×192 PNG icon.
- `install-icon-512` serves the manifest's 512×512 PNG icon.
- `install-favicon` exposes a browser favicon link.

## How to get to it (user POV)

- Open Julia's root page and follow its browser-provided install metadata link.
- The browser reads the manifest and requested icon URLs from the same origin as the home page.
- This feature describes the served install metadata/assets. It does not test a phone's operating-system install prompt or an actual installation.

## Driving it with Playwright CLI

Preconditions:

- `$run` contains the JSON returned by `node scripts/verify-julia.mjs launch` in this same PowerShell session.
- `node scripts/verify-julia.mjs doctor` passes immediately before driving.
- The named CLI session is open at Julia's root page.

- **Check the user's manifest entry point.** Read the actual manifest link from the home page. Run `npx --no-install playwright cli -s="$($run.session)" --raw eval "() => ({pageOrigin:location.origin,manifestHref:document.querySelector('link[rel=manifest]')?.href,faviconCount:document.querySelectorAll('link[rel=icon]').length})" | Set-Content -Encoding utf8 "$($run.evidenceDir)\manifest-entry.json"`. The raw CLI result is a JSON object (not a JSON-encoded string); parse the saved file with `Get-Content ... -Raw | ConvertFrom-Json`. The link exists, resolves to the same origin as `$run.url`, and at least one favicon link is present.
- **Fetch and inspect the manifest and icons.** Exercise the live URLs from that link and save status, content type, manifest values, and decoded icon sizes. Run `npx --no-install playwright cli "-s=$($run.session)" --raw run-code "async page => page.evaluate(async () => { const link = document.querySelector('link[rel=manifest]'); const url = new URL(link.href); const response = await fetch(url); const manifest = await response.json(); const icons = await Promise.all(manifest.icons.map(async icon => { const iconUrl = new URL(icon.src, url); const iconResponse = await fetch(iconUrl); const bitmap = await createImageBitmap(await iconResponse.blob()); return {url:iconUrl.href,status:iconResponse.status,type:iconResponse.headers.get('content-type'),width:bitmap.width,height:bitmap.height}; })); return {pageOrigin:location.origin,manifestUrl:url.href,manifestStatus:response.status,manifestType:response.headers.get('content-type'),manifest,icons}; })" | Set-Content -Encoding utf8 "$($run.evidenceDir)\manifest-assets.json"`. The manifest is HTTP 200 with manifest JSON content type; it names Julia, has `/` for `start_url` and `scope`, and uses standalone display. Its two same-origin icons are HTTP 200 `image/png` responses with dimensions 192×192 and 512×512.
- **Compare repeat assertion.** The Playwright regression command from the [home recipe](./home-content.md) runs the existing manifest/assets assertions against `$run.url`; save its output and exit code.
- **Record side effects.** No persistent household data is created or changed by reading the home page, manifest, or icon files. Record `not applicable` in the run transcript.

## Gotchas

- Resolve the manifest link relative to the current page and compare origins; a hardcoded manifest path can miss a broken or cross-origin link.
- Check both the manifest response and the actual icon responses. A metadata declaration alone does not prove the files exist or decode.
- MIME type and declared size are not enough; the browser must decode each PNG and report the expected natural dimensions.
- A manifest/assets pass is not evidence that a phone installed the app.
