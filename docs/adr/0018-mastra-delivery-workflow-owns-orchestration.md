# 0018. Mastra delivery workflow owns orchestration

Date: 2026-10-13

Status: Accepted (Todd, in conversation, 13 Oct 2026)

One durable Mastra Workflow owns delivery from authorized intake through merge. Builder and
reviewer agents perform their bounded jobs inside that workflow; deterministic workflow steps own
checks, retries, pull requests, preview readiness, smoke testing, UAT suspension and resumption,
merge, and production confirmation. A narrowly bounded crash-fixer may make one minimal repair to
delivery machinery per incident; a different-company reviewer must accept that repair before the
card resumes. Do not add a general supervisor or chief-of-staff agent.
