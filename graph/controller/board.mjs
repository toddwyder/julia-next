// board.mjs -- JUL-98 step 2, item 1: the REAL board the controller writes
// through, as the controller's own Linear identity.
//
// core.mjs takes a `board` with three methods -- `listReadyCards`, `comment`,
// `moveCard` (and the carry adds `updateComment`, JUL-98 step 8). Every test injects a stand-in for it. THIS is the implementation
// that runs for real, and it exists so the app identity in ./token.mjs is
// actually used: without it that token machinery had no caller at all.
//
// Two things it deliberately does NOT do.
//
//   * It does not re-implement a single Linear query. The queries, the
//     100-card overflow guard, the normalisation of labels and blockers, and
//     the "did the mutation report success?" checks are ready-queue.mjs's
//     `createLinearClient`, live-verified against the real API (see that
//     file's own header comments, 2026-09-18 and 2026-09-20). A second copy
//     would let the board and the queue disagree about the same column.
//   * It does not know the app's credentials. `createLinearClient` takes an
//     injected `linearGraphQLImpl`; what this module supplies is that call
//     wrapped in `createAuthedLinearCall` (./token.mjs), so every request
//     carries a freshly-valid app token and a refused one renews and retries
//     exactly once. No `apiKey` is passed anywhere below -- a personal key
//     cannot reach Linear through this board even by accident.
//
// WHO SUPPLIES THE CREDENTIALS. Nobody, here. The default `tokenProvider`
// reads `linear-app-id`/`linear-app-secret` from the drop box in-process, at
// the moment a token is needed, and those two fields are readable by the
// `orchestrator-svc` account ONLY. A builder runs as `runner`, cannot read
// them, and must not try: every test injects a token provider instead. So what
// is proven by test is the wiring -- which header goes out, which query, which
// retry. That the live Linear API accepts this app's token on these mutations
// can only be proven when the controller runs for real as `orchestrator-svc`.

import { linearGraphQL } from '../../scripts/linear-cli.mjs';
import { createLinearClient, DEFAULT_TEAM_NAME, DEFAULT_STATE_NAME } from '../../scripts/ready-queue.mjs';
import { createAppTokenProvider, createAuthedLinearCall } from './token.mjs';

export function createControllerBoard({
  tokenProvider = createAppTokenProvider(),
  fetchImpl = fetch,
  teamName = DEFAULT_TEAM_NAME,
  readyStateName = DEFAULT_STATE_NAME,
  linearGraphQLImpl = linearGraphQL,
} = {}) {
  // One Linear call, made as the app. `createAuthedLinearCall` owns the
  // renew-once-and-retry rule; nothing here repeats it.
  const authedGraphQL = createAuthedLinearCall({
    tokenProvider,
    call: (token, query, variables) => linearGraphQLImpl(query, variables, { accessToken: token, fetchImpl }),
  });

  // The third argument `createLinearClient` passes is its own `callOpts`
  // (`{ apiKey, fetchImpl }`), and it is dropped on purpose: the identity is
  // the app token, which the wrapper above supplies per call.
  const client = createLinearClient({
    linearGraphQLImpl: (query, variables) => authedGraphQL(query, variables),
  });

  // Column name -> Linear state id. The board's nine columns do not change
  // inside a check cycle, and a cycle moves one card, so one lookup per column
  // name per process is enough. A name the team does not have is an error --
  // never a silent no-op, which would leave a card commented-on but unmoved.
  const stateIds = new Map();
  async function stateIdFor(stateName) {
    if (stateIds.has(stateName)) return stateIds.get(stateName);
    const state = await client.findState({ teamName, stateName });
    if (!state) {
      throw new Error(`controller board: the ${teamName} team has no column named ${stateName}`);
    }
    stateIds.set(stateName, state.id);
    return state.id;
  }

  return {
    async listReadyCards() {
      return client.listIssuesInState(await stateIdFor(readyStateName));
    },
    async comment({ issueId, body }) {
      return client.comment({ issueId, body });
    },
    // JUL-98 step 8: the worker-progress comment is edited in place.
    async updateComment({ commentId, body }) {
      return client.updateComment({ commentId, body });
    },
    async moveCard({ issueId, to }) {
      return client.setIssueState({ issueId, stateId: await stateIdFor(to) });
    },
  };
}
