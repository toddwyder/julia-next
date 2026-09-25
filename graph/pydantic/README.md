# The Pydantic graph (JUL-118, JUL-126, JUL-127, JUL-128)

`julia_graph` takes one Linear card through a builder, tests, and an independent reviewer, and posts the result
on the card (JUL-116, JUL-128).

```
Resume -> Prepare -> Build -> Test -> Review -> Report -> end
                       ^                 |
                       |    findings     |
                       +-----------------+
```

## What the library gives, and what this code adds

Checked against the installed `pydantic-graph==2.49.0` (the pin is in `requirements.txt`).

| Need | Where it comes from |
| --- | --- |
| Typed state, nodes, routing from each node's return type | pydantic-graph (`GraphBuilder`, `BaseNode`, `End`) |
| Saved progress across a restart | this code (`checkpoint.py`). 2.49.0 has no persistence module; the 1.x `FileStatePersistence` is gone. One JSON file per card, replaced atomically after every step. |
| One graph per card | this code: a lock file held for the whole run |
| No second worker after a restart | this code: before any builder, test or reviewer run starts, the graph looks for a live one in the process table and waits for it to end; if it will not end, the card says so and nothing starts. The check is machine-wide on purpose: one builder at a time across all cards (JUL-116 story 3) |
| The builder stays in its folder (JUL-127) | this code: each card's working copy, `/srv/julia-runner/worktrees/card-<number>`, is a local clone of the repo, not a `git worktree`. A worktree's `.git` is a pointer into the main repo, outside the one folder headless agy lets Gemini read, and agy ends the whole turn on that refusal (live JUL-142 and JUL-144, 25 Sep). The repo's copy of GitHub's `main` is fetched into the clone, because the server's repo is shallow. A card run again keeps the name `card-<number>`, the only one the worker launchers accept, and the earlier copy moves to `card-<number>.runN`. |
| Unfinished work never counted as done | this code: `build_started` is saved before the builder starts; a restart that finds it set reports the attempt as interrupted, puts the working copy back to the base commit and builds again (at most two attempts) |
| One result comment | this code: comments carry a `graph: <step> card=...` marker line, and the card is checked for it before posting |
| Where the card is (JUL-126) | this code (`status.py`): one "Where this card is" comment, edited in place, shows the step, who is working, the time limit, when the card last moved, and the steps so far. A restart finds it by its `graph: status` marker and never posts a second one. Worker output moves the card at once but edits the comment at most once a minute. Its last line, `graph-moved: <time> running=<step> limit=<seconds>`, is for the stuck check (JUL-129). |
| Ready starts the card (JUL-127) | this code (`board.py`): `python -m julia_graph serve` checks the Ready column now and then about once a minute (no webhook). Cards are taken in board order (lowest `sortOrder` first). A blocked card (a blocker short of UAT), a Parent or Decision card, or one with no numbered `## UAT plan` steps gets one plain "will not start" comment, edited only when the reason changes, and never holds up the cards below it. The top eligible card moves to Implementation and its run starts in its own thread. |
| Only one builder, even across restarts (JUL-127) | this code: one board per machine (`board.lock`, held while the service runs), one check at a time inside it, and a builder reservation (`builder.json`) written before a card starts and removed when its run ends. A restart that finds the reservation resumes that card before looking at Ready. |
| UAT steps locked at the start (JUL-127) | this code: the card's `## UAT plan` section is saved in its progress when it starts, and the builder is always shown that version. Todd's `Instruction:` comments are added to the brief; they are the only way to change the steps afterwards. |
| Worker time limits (JUL-126) | the worker launchers, not the graph (`ops/julia-runner/time-limit.mjs`): the builder has 60 min, tests 15 min, and reviewer 20 min by default. Past the limit, the worker's process group is stopped, then any process its account still runs, so a stop happens even if the graph has died. The worker exits 124; the card says which step, how long it ran, and whether it is gone. `--builder-limit`, `--tests-limit` and `--reviewer-limit` set shorter limits to prove a stop on a throwaway card. |
| Independent review (JUL-128) | pydantic-graph (`BaseNode[CardRun, Deps, str]`) + this code: independent reviewer from a different maker (DeepSeek vs Google builder) reviews full change after tests pass; findings return to builder; 2 failed rounds stop with both reasons in one comment; crash/timeout is never approval; tampering voids review; stopped card assigned to Todd only for account/money/product decisions. |

## The workers

The graph runs as `orchestrator-svc` and reuses the minimal runner's server setup
(`ops/julia-runner/README.md`): the builder is Gemini as `gemini-worker` (edits only, runs no
command) and the tests run as `julia-tester` (`npm run lint:framework`, then
`node --test scripts/*.test.mjs`), each through its fixed sudo rule. The graph, not the
builder, commits the change; the commit is read from git.

## Install and run on the server

As `ubuntu`, from a checkout of the reviewed commit at `/srv/julia-runner/graph-code`:

```
sudo -u orchestrator-svc python3 -m venv /srv/julia-runner/graph-venv
sudo -u orchestrator-svc /srv/julia-runner/graph-venv/bin/pip install -r /srv/julia-runner/graph-code/graph/pydantic/requirements.txt
sudo systemd-run --uid=orchestrator-svc --gid=orchestrator-svc --pipe --wait --collect \
  --working-directory=/srv/julia-runner/graph-code/graph/pydantic \
  -p LoadCredentialEncrypted=linear-app-id:/etc/credstore.encrypted/julia-runner-linear-app-id.cred \
  -p LoadCredentialEncrypted=linear-app-secret:/etc/credstore.encrypted/julia-runner-linear-app-secret.cred \
  /srv/julia-runner/graph-venv/bin/python -m julia_graph JUL-NN --base <origin/main commit>
```

Running the same command again resumes the card from its saved step. Saved progress is in
`/srv/julia-runner/graph-state/`.

### The graph as a service (JUL-127)

The service runs `python -m julia_graph serve` with the same account, credentials and code
folder. Install it from the same checkout:

```
sudo install -o root -g root -m 0644 /srv/julia-runner/graph-code/graph/pydantic/julia-graph.service /etc/systemd/system/julia-graph.service
sudo systemctl daemon-reload
sudo systemctl enable --now julia-graph
journalctl -u julia-graph -f     # one "board: ..." line per check
```

Only one graph may check the board: while the service runs, a hand run of `serve` stops with
"another graph is already checking the board". A hand run of a single card (above) still works
alongside it. Its builder is covered by the graph's machine-wide no-second-worker check.

## Tests

`python -m unittest` in this folder (Linux: the card lock uses `fcntl`). The workers are
scripted fakes; git is real.
