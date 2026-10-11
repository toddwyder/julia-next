# 0012. Review, preview UAT, then merge

Date: 2026-10-11

Status: accepted

Julia delivery order is:

1. an independent reviewer accepts the immutable candidate and CI is green;
2. Todd performs the card's UAT against that candidate's Vercel preview;
3. the pull request may be merged only after Todd accepts the UAT result.

The reviewer and automated runners do not merge. If review or UAT fails, the candidate returns for
repair and must be reviewed and tested again at its new identity.

This decision supersedes only ADR 0009's historical merge-first, live-after-merge UAT order. ADR
0009 otherwise remains retired historical context.
