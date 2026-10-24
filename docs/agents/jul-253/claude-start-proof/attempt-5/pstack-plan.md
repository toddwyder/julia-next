**Files**
- `JUL-253-START-PRACTICE-4.txt` (new, repository root): the only deliverable. Contents are exactly `Julia Claude and DeepSeek Start proof.` plus one trailing newline (39 bytes).
- `docs/agents/JUL-262/` (todo list and decision log, per AGENTS.md): keep these out of the candidate commit so the commit contains only the marker, as the card requires. Record them uncommitted or in a separate non-candidate commit, and note this choice in the decision log.

**Steps**
1. Confirm the worktree is at HEAD with no pending changes, and that `JUL-253-START-PRACTICE-4.txt` does not already exist.
2. Create `JUL-253-START-PRACTICE-4.txt` at the repository root with the exact contents above, ending in one `\n`.
3. Read the file back and check the byte count is 39 and the bytes match the marker exactly, with no extra trailing newline or whitespace.
4. Run `git status` and confirm the marker is the only new path. Do not stage the decision log or todo list.
5. Commit the marker with a message explaining why it exists (practice proof for the JUL-253 Start candidate), including the `Co-Authored-By` trailer. Confirm the commit is nonempty and touches only that file.
6. Push the branch. Do not merge it or treat it as published. Flag to Todd that AGENTS.md's "open PR to main" and branch-PR CI rules conflict with the card's "do not publish the marker" rule, and wait for his decision before opening a PR.
7. Do not start the Start page, a browser, servers, Tailscale, or the ledger. Do not touch earlier practice cards, reset accounting, or change the cap. Leave the host-owned proof to the host.
8. Report the candidate commit SHA, the byte-check result, and the open PR question.
