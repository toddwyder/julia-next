# The Pydantic build-and-test graph (JUL-118)

`julia_graph` takes one Linear card through a builder and the tests, and posts the result
on the card. It is the first path of the Pydantic graph (JUL-116): no review, merge or UAT
steps yet.

```
Resume -> Prepare -> Build -> Test -> Report -> end
                      |  failure       ^
                      +----------------+
```

## What the library gives, and what this code adds

Checked against the installed `pydantic-graph==2.49.0` (the pin is in `requirements.txt`).

| Need | Where it comes from |
| --- | --- |
| Typed state, nodes, routing from each node's return type | pydantic-graph (`GraphBuilder`, `BaseNode`, `End`) |
| Saved progress across a restart | this code (`checkpoint.py`). 2.49.0 has no persistence module; the 1.x `FileStatePersistence` is gone. One JSON file per card, replaced atomically after every step. |
| One graph per card | this code: a lock file held for the whole run |
| No second worker after a restart | this code: before any builder or test run starts, the graph looks for a live one in the process table and waits for it to end; if it will not end, the card says so and nothing starts |
| Unfinished work never counted as done | this code: `build_started` is saved before the builder starts; a restart that finds it set reports the attempt as interrupted, puts the working copy back to the base commit and builds again (at most two attempts) |
| One result comment | this code: comments carry a `graph: <step> card=...` marker line, and the card is checked for it before posting |

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

## Tests

`python -m unittest` in this folder (Linux: the card lock uses `fcntl`). The workers are
scripted fakes; git is real.
