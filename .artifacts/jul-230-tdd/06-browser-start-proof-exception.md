# JUL-230 browser-Start historical-red exception

On 2026-10-15, Todd explicitly approved an exception for the missing historical
browser-Start red proof.

The retained `06-browser-start-red.txt` artifact is unchanged. It truthfully records
a retrospective application of the behavior test to the pre-JUL-230 baseline. It
demonstrates that the baseline lacked the behavior, but it does not demonstrate that
the browser-Start test was run before its implementation.

This exception accepts that missing historical ordering evidence for JUL-230 only.
It does not recast the retrospective run as test-first evidence, fabricate an earlier
run, rewrite repository history, or waive any other verification requirement.
