# Dashboard walkthroughs (27 Oct 2026)

Screen-by-screen work from the dashboard pilot: every control on an approved picture is numbered and says what it is, where it comes from and which user story it serves. Procedure: Linear doc "Reconciling requirements to screens (pilot procedure, 27 Oct 2026)" in the Framework project.

- `pages/` — the three published walkthrough pages (self-contained HTML; open in a browser). Each holds the annotated picture, the controls, the gaps, and the full list of stories, rules, build work and comments.
  - `start-walkthrough.html` — Start screen (picture 08): 24 controls, gaps G1–G10 closed or left for the build.
  - `board-walkthrough.html` — phone board (picture 02): 19 controls, gaps G1–G8 closed.
  - `running-card-walkthrough.html` — running card (picture 04): 21 controls, gap G1 and G2 closed, G3–G8 still open.
- `stopped-card-walkthrough.html`, `needs-you-walkthrough.html`, `card-page-walkthrough.html` — Stopped card (05), Needs you (06), card page (07), all gaps decided (card page: 0041–0056).
  - `decision-support-{map,ranked,cards}-walkthrough.html` — Decision support (09–11), decided in 0057–0070.
- `data/stories-rules-build-comments.json` — the current 62 stories (S-01…S-62), 14 rules (R-01…R-14), 13 build items (B-01…B-13) and the comments (C-01…C-16). The newest version of each.
- `data/*-controls-and-gaps.json` — each screen's controls and gaps as data.
- `data/stories-original-and-comments.md` — the first 57-story draft with the design-chat comments and open facts (F-01…F-07).
- `data/approved-design-doc.md` — copy of the "Approved design" Linear document.

Trace key: R1a/R1b = Todd's two R1 lists; I, S, D, E + number = turns in chats 01–04 of `../chats/`; P = the spec chat (time of day); four-digit numbers = decisions; Gl = glossary; PL = parking lot.
