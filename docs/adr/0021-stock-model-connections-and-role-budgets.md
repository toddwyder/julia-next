# 0021. Stock model connections and role budgets

Date: 2026-10-13

Status: Accepted (Todd, in conversation, 13 Oct 2026). The role budgets below are superseded by [ADR 0022](0022-subscriptions-and-card-cap.md), accepted 23 October 2026.

Julia exposes one builder/reviewer contract over stock Mastra connection types: Mastra's coding
agent for ordinary model APIs, official Mastra SDK adapters for service-owned coding runtimes, and
ACP for compatible external coding applications. Every live model offered by a configured
connection is selectable for builder, reviewer, crash-fixer, or fix reviewer; the chosen exact
model and connection are recorded, Julia never silently substitutes a model, and defaults are
changed through `$models` rather than repository JSON. Builder and reviewer normally use different
companies and services; crash-fixer and fix reviewer must use different companies.

Paid API limits are $2 total builder spend per card, $1 total reviewer spend per card, $0.50 per
crash-fixer incident, and $0.25 per fix-review incident. Subscription limits are 90 active builder
minutes and 30 active reviewer minutes per card, plus 20 active crash-fixer minutes and 10 active
fix-review minutes per incident. Waiting on CI, preview, UAT, or Todd does not count. Reaching any
limit stops the run until Todd stops it, records a specific increase, or selects another model.
