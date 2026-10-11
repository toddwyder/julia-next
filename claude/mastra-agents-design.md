# Mastra agent limits

The independent reviewer uses the existing CommandCode connection and defaults to
`deepseek/deepseek-v4.1-flash`. Its best-effort limit is **$1.00 per card**.

Each card has a separate **$1.00** reviewer ceiling across at most **four** live runs. JUL-206
covers the review of PR #282; the review of PR #287 has its own $1.00 ceiling. This is launcher
authorization, not prompt content. The reviewer request has no output-token cap.
