# Dashboard pilot design screens (D2)

Todd chose **Mint & Iris** from the earlier desktop drawings. The new phone layout is his vertical accordion. Nothing here is app code.

## Mint & Iris: phone accordion

**[Compare the chosen desktop and both phone states side by side](screens/mint-iris-comparison.png).** The original nine options remain below for reference.

| State | Picture and HTML | Stitch screen ID | Requests |
| --- | --- | --- | --- |
| Chosen desktop: Mint & Iris | [PNG](screens/mint-iris-desktop-source.png), [HTML](screens/mint-iris-desktop-source.html) | `bab9a7fc3eea45e288ab3a81f19f33d2` | [Confirm source](requests/get-screen-mint-iris-desktop-source.json) |
| Phone: as loaded | [PNG](screens/mint-iris-accordion-loaded-applied.png), [HTML](screens/mint-iris-accordion-loaded-applied.html) | `1bf5cf3ba518483691ae0afd71855b85` | [Generate](requests/mint-iris-accordion-loaded.json), [phone correction](requests/mint-iris-accordion-loaded-phone.json), [apply system](requests/mint-iris-apply-system.json) |
| Phone: running card open | [PNG](screens/mint-iris-accordion-card-open-final.png), [HTML](screens/mint-iris-accordion-card-open-final.html) | `c4c69ed3a37d42afb18d4bf2d15d5d68` | [Draw](requests/mint-iris-accordion-card-open-retry.json), [collapse other cards](requests/mint-iris-accordion-card-open-corrected.json), [real Linear link](requests/mint-iris-accordion-card-open-final.json) |

All are in project `12943705270951129641`. The named **Mint & Iris** design system is `assets/17575707340211662328`: [create request](requests/mint-iris-create-system.json), [response](responses/mint-iris-create-system.json), [saved-system listing](responses/mint-iris-list-systems.json). Generation explicitly used that asset; `apply_design_system` was also called with its unprefixed asset ID and the phone screen instance/source pair. It produced the final as-loaded screen above.

### Appearance and checks

The side-by-side picture uses the original Stitch PNGs, resized only for comparison. Both phone originals were validated by their PNG signature and `file`, then viewed individually at full width. As loaded is **780 × 1768**; card open is **780 × 2356**. The latter is taller to retain all lower stages, not a sideways-scrolling layout.

- Same Public Sans headings/body, JetBrains Mono metrics, cool `#F3F6F8` background, white rounded cards, mint `#10B981` / `#059669`, iris `#6366F1` / `#EEF2FF` as the selected desktop HTML. Running is iris, stuck rose, waiting amber.
- Stage order/counts: Backlog 30; Ready 1; Implementation 1; Evidence review 0; Remediation 1; Staging/smoke test 0; UAT 1; Complete 12. Only Implementation, Remediation and UAT stages start open. All cards start collapsed; the second drawing expands only the running card.
- Both Needs-you items, Decision support, full card titles and all eight stage headings are readable in the pictures. The running card shows step 4 of 8, running tests, active 40 s ago, 12 min elapsed, $0.84 spent, context 41% with a bar, Main session, Coder, Stop and Linear issue. Its link targets the recorded JUL-271 issue, not an invented identifier.
- Ready's title and Start button, and Remediation's “No activity for 7 min”, remain in their folded HTML. They are intentionally not visible in these two pictured states. This is a design export, not a live dashboard: other navigation/actions remain mock anchors/buttons.
- [Machine-readable checks](mint-iris-checks.json) record PNG signatures, palette/font tokens, eight stage counts and default states, required hidden content, and native card toggling in Chromium. External assets were blocked for that DOM check; layout/readability was checked on the actual Stitch PNGs, not claimed from the unstyled browser page.

### What failed and how it was corrected

1. The first generation `656e105b950344f4aa190bba57155316` returned a **DESKTOP** 2560 × 2048 canvas despite `deviceType: MOBILE`, plus extra subtitle/review copy. `edit_screens` explicitly requested native 390 CSS px / 780 physical px, no desktop gutters, and removal of those strings. Result: phone screen `c6ab3d9a95b640ddad94cb0e37e0a6bb`; applying the named system produced the final as-loaded screen.
2. The first card-open edit returned **“The service is currently unavailable.”** The [failure response](responses/mint-iris-accordion-card-open.json) is retained. `list_screens` was checked before one retry; the retry returned a completed screen.
3. That screen `9a596fe0a178450db29f8d8767caebf1` expanded all three cards and copied running metrics into Remediation and UAT. A targeted edit collapsed those two cards, retaining their open stages and restoring the stuck card's own hidden message. Corrected screen: `eb25afcef8e04cd19b2c192ce0979fff`.
4. The running card's issue link was a mock anchor. A final HTML-only Stitch edit wired the actual JUL-271 URL. Its PNG is byte-for-byte identical to the corrected picture; the final HTML contains the real URL.

Earlier attempts, exports, requests and replies are retained. Nothing was deleted in Stitch. API keys are read only through the agents' key route, never included in saved artifacts. No app files changed and this PR stays draft and unmerged.

- Stitch project: **Julia dashboard pilot**, ID `12943705270951129641`, made with Todd's Stitch key. No screen was deleted.
- Board prompt and taste profile: [prompt.md](prompt.md). Every request is in [requests/](requests/) with the key replaced by `[REDACTED]`; every reply is in [responses/](responses/). The `tools/list` reply is [tools-list.json](tools-list.json).
- Every PNG below was checked with `file` (real PNG data) and looked at full size before it went in this table.

## The nine screens to pick from

| File | Layout | Look | Stitch project ID | Screen ID | Prompt used |
| --- | --- | --- | --- | --- | --- |
| [desktop-look-1-v2.png](screens/desktop-look-1-v2.png) ([html](screens/desktop-look-1-v2.html)) | Desktop, all eight columns | Warm editorial | 12943705270951129641 | 6531734b410645e3a713a0be49c7d8e2 | [variants-desktop](requests/variants-desktop.json), then [edit-desktop-look-1](requests/edit-desktop-look-1.json) |
| [desktop-look-2-v2.png](screens/desktop-look-2-v2.png) ([html](screens/desktop-look-2-v2.html)) | Desktop, all eight columns | Data infographic | 12943705270951129641 | 4f0e5369318649f28e9a51718a0b2a8f | [variants-desktop](requests/variants-desktop.json), then [edit-desktop-look-2](requests/edit-desktop-look-2.json) |
| [desktop-look-3-v2.png](screens/desktop-look-3-v2.png) ([html](screens/desktop-look-3-v2.html)) | Desktop, all eight columns | Vibrant pop | 12943705270951129641 | f8bb36ec95b44a75adf458e2bd4e7733 | [variants-desktop](requests/variants-desktop.json), then [edit-desktop-look-3](requests/edit-desktop-look-3.json) |
| [phone-sideways-look-1.png](screens/phone-sideways-look-1.png) ([html](screens/phone-sideways-look-1.html)) | Phone, columns scroll sideways, "Needs you" fixed on top | Grit mint and tangerine | 12943705270951129641 | ab1c9032cf2e4339adbdf718d42c3a4b | [variants-phone-sideways](requests/variants-phone-sideways.json) |
| [phone-sideways-look-2.png](screens/phone-sideways-look-2.png) ([html](screens/phone-sideways-look-2.html)) | Phone, columns scroll sideways, "Needs you" fixed on top | Solar pop blueprint | 12943705270951129641 | c56d6d9a94c442e4bbb134e3a29796a5 | [variants-phone-sideways](requests/variants-phone-sideways.json) |
| [phone-sideways-look-3.png](screens/phone-sideways-look-3.png) ([html](screens/phone-sideways-look-3.html)) | Phone, columns scroll sideways, "Needs you" fixed on top | Warm editorial infographic | 12943705270951129641 | ccffaeccd94349538104d64200d83290 | [variants-phone-sideways](requests/variants-phone-sideways.json) |
| [phone-tabs-look-1.png](screens/phone-tabs-look-1.png) ([html](screens/phone-tabs-look-1.html)) | Phone, one column at a time by tabs | Neo-vibrant Grit | 12943705270951129641 | dbb1b0e5bb2a411baac2686555e226cb | [variants-phone-tabs](requests/variants-phone-tabs.json) |
| [phone-tabs-look-2.png](screens/phone-tabs-look-2.png) ([html](screens/phone-tabs-look-2.html)) | Phone, one column at a time by tabs | Editorial warmth | 12943705270951129641 | 613aa11a86374af98f2f67a9a75e210c | [variants-phone-tabs](requests/variants-phone-tabs.json) |
| [phone-tabs-look-3.png](screens/phone-tabs-look-3.png) ([html](screens/phone-tabs-look-3.html)) | Phone, one column at a time by tabs | Blueprint data | 12943705270951129641 | 1118044880194fd28a23505d95accbcb | [variants-phone-tabs](requests/variants-phone-tabs.json) |

All three variant calls used `generate_variants` with `variantCount: 3`, `creativeRange: EXPLORE`, `aspects: [COLOR_SCHEME, TEXT_FONT]`, so only colour and type change between looks of one layout.

## Layout screens the looks came from

| File | Layout | Stitch project ID | Screen ID | Prompt used |
| --- | --- | --- | --- | --- |
| [layout-desktop-v2.png](screens/layout-desktop-v2.png) | Desktop | 12943705270951129641 | ea114c7e1ea2449cbe6db17be564ef2d | [layout-desktop](requests/layout-desktop.json), then [edit-layout-desktop](requests/edit-layout-desktop.json) |
| [layout-phone-sideways-v2.png](screens/layout-phone-sideways-v2.png) | Phone, sideways | 12943705270951129641 | ceaf6b9095f4425e88dd9a2fa0137898 | [layout-phone-sideways-retry](requests/layout-phone-sideways-retry.json), then [edit-layout-phone-sideways](requests/edit-layout-phone-sideways.json) |
| [layout-phone-tabs.png](screens/layout-phone-tabs.png) | Phone, tabs | 12943705270951129641 | 0b4f43410a724de6a0414c169f6db308 | [layout-phone-tabs](requests/layout-phone-tabs.json) |

## Checks and what they found

Every final screen's HTML holds all eight board tiles, both "Needs you" items and the "Decision support" link. Visual check of each PNG:

- **Desktop.** The first desktop screens (`layout-desktop`, `desktop-look-1..3`, screens `43fc5d81…`, `d38eb35e…`, `e8820841…`, `4c039666…`) stopped after column 6; UAT and Complete fell off the right edge. Each was redrawn with one `edit_screens` call asking for all eight columns in the frame. The `-v2` screens show all eight. Some column titles are shortened with "…" but stay readable.
- **Phone, sideways.** The first generation (screen `2204d45e664841f186d6c424e08c3e65`) stalled at "Creating the UX flows" and never got an image or HTML; it still sits in the project, titled "Generating Screen...". A fresh generation gave `5506e9428f2a45cf83cc93f66845415c`, whose "Needs you" strip cut off the first item. `edit_screens` fixed that (`ceaf6b90…`), and the three looks were made from the fixed screen.
- **Phone, sideways, wrong layout.** The first sideways look batch reused the desktop variant prompt by mistake ("Layout: All eight columns visible"). Stitch drew three desktop boards at 2560×2048 (screens `081f9eda…`, `48645f50…`, `bab9a7fc…`). They are kept as `screens/superseded-desktop-from-sideways-{1,2,3}` with request/response `variants-phone-sideways-wrong-layout.json`, and are not candidates.
- **Phone, tabs.** Tabs pick a column; under them the screen also stacks the remaining tiles, so Todd sees every tile on one scroll. Every tile is readable.
- **Made-up detail.** Stitch added small details the prompt did not give, such as `LIN-…` numbers, "Run #418" and "99.2% alignment". They are design filler, not real Linear data; the real build links to the actual Linear issues.

## Download failures

The first downloads fetched each screen's `downloadUrl` and saved the reply straight to `.png`. The reply was JSON (`{"imageMetadata":{"mimeType":"png"},"dataString":"<base64>"}`), not image bytes, so `base-desktop.png` and `base-phone-tabs.png` were really JSON text. They are kept as evidence in `screens/failed-download-*.json`. The fix, from the `tools/list` schema: call the `download_file` tool with the screen's `screenshot.name` / `htmlCode.name`, decode the base64 `image` field, and refuse to write a `.png` unless it starts with the PNG signature. Every PNG in the tables above was saved that way.
