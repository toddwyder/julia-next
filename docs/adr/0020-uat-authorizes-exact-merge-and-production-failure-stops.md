# 0020. UAT authorizes the exact merge and production failure stops

Date: 2026-10-13

Status: Accepted (Todd, in conversation, 13 Oct 2026)

Todd's guided UAT approval authorizes the workflow to merge only the exact commit tested in the
Vercel preview. Any source change invalidates that approval and repeats review, preview, smoke,
evidence review, and UAT. After merge, the workflow performs a read-only production confirmation;
failure stops the run and offers a prepared restoration of the previous healthy Vercel deployment,
but only Todd may authorize that restoration.

This supersedes ADR 0012's sentence that an automated runner never merges. Its independent-review,
preview-UAT, and immutable-candidate ordering remains accepted.
