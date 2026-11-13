---
Status: proposed. Todd decided 30 Oct 2026.
---
# Agents judge; runners are machines

Runners start every agent, carry its output, and make every write to Linear and GitHub under their own name; the agent drafts the pull request text and the runner posts it. Agents work alone, each unaware of the others, and only the runner starts Shipping and picks its model. Before Shipping, the runner confirms the build's evidence is present (presence only, never quality) and returns a build that lacks it; the same criterion missing twice stops the card, counted apart from Shipping FAILs. Why: a homemade runner drained CommandCode by restarting judges and builders routed around the process, so machines hold the process and agents bring the judgment.
