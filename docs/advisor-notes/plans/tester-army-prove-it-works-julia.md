# Check out TesterArmy e2e for Prove It Works on Julia

Saved 31 Oct 2026 at Todd's request. Status: to check out, not decided, nothing built.

Source: https://github.com/tester-army/e2e (read once on 31 Oct; facts below are from that page and npm only).

## What the page says it is

* Open-source end-to-end testing framework for web and mobile apps, by TesterArmy. Apache-2.0. About 8.1k stars, 710 commits.
* Real usage: npm shows 587,240 downloads of `e2e` and 508,209 of `@e2e-dev/web` for 23 to 29 October 2026 (checked 31 Oct). Todd does not judge tools by version number, so the "before 1.0" label is not a concern. Downloads can include automated installs, so this shows wide use, not proof it works.
* A test pairs a plain-language goal with ordinary assertions. An AI agent carries out the goal in the app, then locators and assertions check the result.
* Web runs on Playwright (Chromium, Firefox, WebKit). Mobile runs on iOS and Android simulators. Examples include Next.js.
* Set up with `npx e2e init`. You bring your own model access (subscription, API key or local model). The page names no model vendor. Tests with no agent step need no model.
* When an agent step is confirmed by a later assertion, it records the agent's actions and replays them without model calls until the app changes. A saved test therefore works as a regression check. A reporter package can post results as pull request comments.

## Why it might fit (my reading, not verified)

* Stock Prove It Works only asks for a re-runnable script and says nothing about re-running proofs after later changes. Replay of verified steps is a ready-made version of that.
* Julia's `verify-julia` already drives Playwright, so the browser layer is the same.

## Questions to settle when we check it out

1. Can it run on a model that costs nothing on Command Code, so proof runs stay free?
2. Does the replay really need no model call on later runs, and what makes it re-run the agent when the app changes?
3. Where do saved tests live, and could the verifier (not the builder) write them, as the plan requires?
4. Its pull request reporter would post as a person or app. The runner needs its own identity, so check how it fits.
5. Does it replace, sit beside, or feed `verify-julia` and its feature recipes?

## Related

* Plan: "Plan: Shipping you can trust 2026-10-31" (Linear, machine-setup), step 7: saved proofs as feature recipes, a deliberate departure from stock with a deviation row.
* The post-deploy smoke test runs nowhere today (step 1 finding), so saved proofs have nothing re-running them yet.
