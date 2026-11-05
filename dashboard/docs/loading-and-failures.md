# Loading, and the failures the dashboard names

Every screen reads Linear before it can draw. This page says what the reader sees while that read
is running, and what each named failure means. It covers the two screens that read Linear for
cards, the Ready list and the Start screen. The health check reads Linear too with wording of its
own, and `service.md` covers it. Builds and the model sweep have their own pages.

## Loading

One line says the read is in progress. On the Ready list the header draws first and the line fills
in under it. On the Start screen the line stands in for the whole screen.

| Screen | Line while the read runs | Where |
| --- | --- | --- |
| Ready list | `Loading Ready cards from Linear…` | The `Suspense` fallback in `app/page.jsx` |
| Start screen | `Loading card from Linear…` | `app/start/[card]/loading.jsx` |

Both lines carry `role="status"`, so a screen reader announces them and neither needs a spinner to
be understood. Every request is capped at 10 seconds end to end, and the failure names which half
was cut, so the loading line always gives way to cards or to a sentence. Nothing is cached, so the
line appears on every visit, not only the first.

## The named failures

A failed read replaces the list, or the Start screen's controls, with one rose sentence that says
what went wrong. The page prints the sentence as written and adds nothing, so the words below are
the words on screen.

| Message | When it appears | What to do |
| --- | --- | --- |
| `Linear configuration failure. LINEAR_API_KEY is missing.` | The dashboard process has no key. | Nothing is wrong in the code. Restart the service through `scripts/julia-agents.mjs`, which supplies the key. |
| `Linear connection failure. The dashboard could not reach Linear.` | The request failed before a reply started: network, DNS or TLS. | Look at the server's network, not the key. |
| `Linear connection failure. The dashboard could not reach Linear within 10 seconds.` | Same, and the reply did not start in 10 seconds. | Linear or the route to it is slow. Try again, then treat it as unreachable. |
| `Linear connection failure. Linear ended its reply before it was complete.` | The reply started and stopped partway. | Try again. A proxy cutting long replies produces this. |
| `Linear connection failure. Linear did not finish its reply within 10 seconds.` | The reply started and then stalled past the cap. | Try again. |
| `Linear request failed. HTTP <status>.<reason>` | Linear answered with a status other than 2xx. The reason is Linear's own words, trimmed to 400 characters, when it sent any. | Read the status. 401 or 403 is the key, 429 is rate limiting, 5xx is Linear's side. |
| `Linear request failed.<reason>` | Linear answered 200 with an `errors` list. | The query is wrong or the key lacks the scope. The reason names which. |
| `Linear returned a malformed response. Expected JSON.` | The reply was not JSON, usually a proxy or login page in the way. | Check what sits between the server and Linear. |
| `Linear returned a malformed Ready list.` | The reply parsed, but holds no `data.issues` of the expected shape. | Linear changed its answer shape. Compare with `readyQuery` in `lib/linear.js`. |
| `Linear returned an unexpected card in the Ready list.` | A card in the reply lacks a field the page needs, is not Ready, or is not in Julia-next. | The filter and the check disagree. Read the first card the log prints. |
| `Linear returned a duplicate card. Reload the list.` | The same card id arrived twice while paging. | Reload. A second card would otherwise vanish silently. |
| `Linear returned invalid pagination for the Ready list.` | `hasNextPage` is true and `endCursor` is missing, empty or repeating. | Reload. Paging would otherwise loop or stop early. |

The last five are refusals. The list shows as failed rather than short, because a card that
silently drops off the Ready list is worse than a list that says it could not be read.

## Adding a failure

- One sentence in plain words that a person can act on. A status code may sit inside it, never as the whole message.
- Raise it in `listReady` in `lib/linear.js`. The pages print `error.message` and decide nothing themselves.
- Cut the key out of any text Linear sends back, and cap what is kept at 400 characters. `providerReason` does both.
- Log the same failure once with `console.error('julia-dashboard: …')`, which lands in the service journal under `julia-dashboard:`. The journal carries the detail; the screen carries the sentence.
- Pin the message with a test in `lib/linear.test.mjs`, so a reworded message is a failing test rather than a surprise for the reader.
