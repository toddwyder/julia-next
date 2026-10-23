# 0022. Stock subscription connections and one card cap

Date: 2026-10-23

Status: Accepted by Todd in the 23 October path-forward decisions and JUL-253.

Use Mastra Code's stock ChatGPT and Anthropic subscription connections alongside CommandCode. Todd authorizes each subscription once. Stock AuthStorage owns persistence, access-token renewal and rejected-login handling. Account authorization does not block independent implementation work.

The Claude decision is settled. Anthropic's [7 October update](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says subscription limits remain available for the Agent SDK, command-line use and third-party applications. [Mastra Code's configuration documentation](https://code.mastra.ai/configuration) describes stock OAuth and lists Claude Max. Todd has Pro. JUL-253 must test a real request with Pro through that stock connection. If it fails, report the result without using an alternative connection. This decision does not claim that the live Pro request has passed.

Each card has one $2 total model budget, including every role, helper, memory request, retry and subsequent run of that card. Subscription calls count at their published API prices despite not necessarily creating an API bill. This replaces the zero-spend trial and the older separate role budgets in ADR 0021. Prices, sources, price tiers and request bounds belong in settings. Unknown prices or bounds refuse dispatch.

One shared SQLite ledger outside job worktrees owns costs and reservations, keyed by card identifier. Concurrent actors reserve against the same remaining balance. Restarted runs retain settled costs and all outstanding holds. Unknown charged outcomes retain their maximum reservation and block further priced dispatch until reconciled. The host may explicitly consume the full reserved maximum without claiming known usage. That operation moves the same amount from held to charged, never increases the remaining budget, and preserves the unknown outcome and its cost basis. That maximum charge is final; late settlement cannot refund it or relabel the unknown usage. A successful positive charge is ordinary accounting, not a reason to stop.

Sol handles the main session and hardest work. DeepSeek handles ordinary coding and swarm workers. Panels contain one Sol and one DeepSeek. Beam handles free machinery checks. A machinery self-check is not independent review. Review the $2 cap after the next real card using its actual measured usage.
