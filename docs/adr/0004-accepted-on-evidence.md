# 0004. A journey is accepted on a recording plus a checklist, gated before Todd sees it

Date: 2026-09-15

> **Note, 2026-09-21 (JUL-98). Partly superseded by [The route](https://linear.app/julia-next/document/the-route-one-description-of-how-a-change-reaches-real-julia-88d1f95bbbfa).**
> The route is now the one description of how a change reaches Real Julia, and where this
> record disagrees with it, the route wins. What the route replaces here:
>
> - **The gate is two columns, not one.** What this record calls "a gate before Todd" is now
>   **Staging and smoke test** followed by **Evidence review**, two named columns of the nine.
>   The scripted check and the separate reviewing agent both live in Evidence review.
> - **Two bounces, not three.** The "three-bounce rule" named under Consequences below is
>   **two**. The evidence gate gets two rounds and then the card parks; code review gets its
>   own two, counted separately.
> - **A card crosses only the columns its work needs.** A change with nothing a person could
>   look at — documents, settings, the machinery itself — skips Staging and smoke test and
>   Evidence review, and records why. A change a person could look at never skips them.
>
> Everything else this record decided still stands: the definition of a journey, the six hard
> rules for evidence, one recording plus a checklist, and Todd judging from the comment and the
> recording alone without reproducing anything. The original text is unchanged below.

ADR 0001 says every small user journey is accepted by Todd on evidence and Todd is never the
tester. This makes that concrete.

A **journey** is one thing a person sets out to do, start to finish; the spec is a list of
them, and each names its device. **Evidence** is one screen recording of the whole journey on
the real, deployed Julia, plus the journey's acceptance checklist with a proof per line.

Six hard rules; any one missing and the evidence is sent back unread: real deployment, not a
local demo; the device the journey names; offline shown with the connection actually off; at
least one failure case, with proof; passing tests are required but are not evidence of the
journey; no claims without artifacts.

The recording is attached to the GitHub pull request (Linear's free plan caps uploads at
10 MB). The Linear comment on the journey's ticket holds the checklist, a plain-English
summary, and a link to the recording. Todd judges from the comment and the linked recording
alone, and answers with one word ("accepted") or one sentence saying what was wrong. He never
reproduces, retries, or reads logs.

A **gate** sits before Todd. Code checks whatever code can (recording linked, checklist lines
match the spec one to one, device stated); a separate reviewing agent handles only what needs
the recording watched. Failing evidence goes back to the builder and never reaches Todd's
ticket. The gate is itself accepted only when deliberately flawed evidence provably bounces.

We chose this over a live link plus summary (makes Todd the tester), over no gate (Todd doing
send-backs is the relay work the restart ends), and over whole-feature journeys (long
recordings, expensive send-backs).

## Consequences

- Every journey in the spec carries a device and at least one failure case, or it can't be
  accepted.
- Use is not testing: anything Todd notices in real use becomes a new ticket in his words.
- How the gate is built (what code runs where, the checklist format, the three-bounce rule,
  the "Gate passed" line) is decided in [The evidence gate](https://linear.app/julia-next/issue/JUL-35).

Decided in [What counts as "accepted on evidence" for a finished user journey?](https://linear.app/julia-next/issue/JUL-9).
