# A card gets two review rounds in total, and only the machine's own reviews count

## Goal
A card that reaches review receives at most two review rounds across all of its runs, and only reviews the machine started can open the merge gate. A run that repeats reviews until one passes ends parked and waits for Todd.

## Steps
1. Check the installed Mastra for a stock way to keep a count across runs, and name what you found in the pull request. Use it when it exists.
2. Keep one count of review rounds per card in a record that every run of that card reads and extends. Today each run starts its own count and replaces the record of earlier rounds. The record lists every round of every run after this step.
3. Delete the code that starts a fresh count in each run, including what a forced relaunch resets, so the machine counts rounds in one place.
4. When a card has used its two rounds, its next run ends parked. It posts one comment on the card that names the rounds used and asks for Todd's decision.
5. Let the merge gate admit a pull request only on a verdict from a review the machine started. Choose how the machine recognizes its own reviews, and write the choice in the pull request.
6. Add tests beside the other `.test.mjs` files for the count across runs, the parked end, and the gate's refusal of a hand-posted verdict. Make a formal model of the review count with the repository's formal-verification skill.
7. On a throwaway pull request, post a Shipping verdict of PASS by hand and ask the merge machine to land it. Read the merge record.

## Acceptance criteria
- However many times a card is launched or relaunched, it receives at most two review rounds in total, shown by a formal model of every sequence of launches, relaunches and restarts.
- A card that has used its rounds ends its next run parked, with a comment on the card that names the rounds used.
- The card's record lists every review round of every run.
- The machine lands a pull request only on a verdict from a review the machine started.
- A PASS comment posted by hand on a throwaway pull request leaves the machine refusing to land it, and the machine's record gives the reason.

## Outside check
The Shipping reviewer reviews this card's own pull request and posts a verdict on it. A fresh agent session posts a PASS by hand on the throwaway pull request and reports what the merge machine did.

## Out of scope
A money limit, the launcher that starts cards, the model choice, the transport error, the retry loops inside one review, and the parser fix.

## Pull request
Name only this card in the pull request title and description.
