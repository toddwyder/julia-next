// controller-board.test.mjs -- JUL-98 step 2, item 1, attempt 2: the REAL board
// the controller writes through.
//
// Attempt 1 built the token machinery (graph/controller/token.mjs) and tested
// it, but nothing called it: `createAppTokenProvider` and
// `createAuthedLinearCall` had no non-test caller, and every controller test
// injected a fake board. This file pins the wiring that makes the app identity
// real -- `createControllerBoard` in graph/controller/board.mjs -- end to end,
// from the token request to the `Authorization` header on each Linear call.
//
// WHAT THE STAND-INS REST ON. There is no recorded Linear response in
// graph/fixtures/orca-1.4.205/ (that directory is Orca's CLI only -- `ls` it),
// so no fixture can be cited here. The stand-in `fetch` returns the shape each
// query itself asks for, and those queries are not invented: they are
// ready-queue.mjs's own live-verified ones (TEAM_STATES_QUERY,
// READY_ISSUES_QUERY, COMMENT_CREATE_MUTATION, ISSUE_SET_STATE_MUTATION,
// whose header comments record the live checks on 2026-09-18/20). The token
// response shape (`access_token` / `expires_in`) is the one token.mjs's header
// records as proven live on 2026-09-21 12:20Z. What is NOT proven by any test
// here is that the live Linear API accepts this app's token on these
// mutations: that can only be proven when the controller runs for real, as
// `orchestrator-svc`, which is the account that can read the app credentials.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { linearGraphQL } from './linear-cli.mjs';
import { createAppTokenProvider } from '../graph/controller/token.mjs';
import { createControllerBoard } from '../graph/controller/board.mjs';

const APP_TOKEN = 'lin_oauth_app_token_aaa';
const RENEWED_TOKEN = 'lin_oauth_app_token_bbb';

// A stand-in token endpoint: one client-credentials POST -> one token.
function tokenFetch(tokens = [APP_TOKEN, RENEWED_TOKEN]) {
  const issued = [];
  const impl = async () => {
    const token = tokens[issued.length] ?? tokens[tokens.length - 1];
    issued.push(token);
    return { ok: true, status: 200, json: async () => ({ access_token: token, expires_in: 30 * 24 * 60 * 60 }) };
  };
  impl.issued = issued;
  return impl;
}

function appTokenProvider(tokens) {
  return createAppTokenProvider({
    readCredentials: () => ({ clientId: 'app-id', clientSecret: 'app-secret' }),
    fetchImpl: tokenFetch(tokens),
  });
}

const READY_STATE = { id: 'state-ready', name: 'Ready', type: 'unstarted' };
const IMPLEMENTATION_STATE = { id: 'state-impl', name: 'Implementation', type: 'started' };

const RAW_CARD = {
  id: 'uuid-JUL-92',
  identifier: 'JUL-92',
  title: 'a card',
  sortOrder: -2889,
  description: '## Acceptance criteria\n\n- [ ] It works.\n\n## UAT plan\n\n1. I look at it.\n',
  state: READY_STATE,
  labels: { nodes: [{ id: 'l1', name: 'builder-claude-opus' }] },
  relations: { nodes: [] },
  inverseRelations: { nodes: [] },
};

// Routes on the operation the query declares, so the stand-in cannot answer a
// query the board did not actually send.
function graphqlFetch({ issues = [RAW_CARD] } = {}) {
  const calls = [];
  const impl = async (url, opts) => {
    const { query, variables } = JSON.parse(opts.body);
    calls.push({ url, authorization: opts.headers.Authorization, query, variables });
    if (/ReadyQueueTeamStates/.test(query)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { teams: { nodes: [{ id: 'team-1', states: { nodes: [READY_STATE, IMPLEMENTATION_STATE] } }] } } }),
      };
    }
    if (/ReadyQueueIssues/.test(query)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { issues: { nodes: issues, pageInfo: { hasNextPage: false, endCursor: null } } } }),
      };
    }
    if (/ReadyQueueComment/.test(query)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { commentCreate: { success: true, comment: { id: 'c1', url: 'https://linear.app/c1' } } } }),
      };
    }
    if (/ReadyQueueSetState/.test(query)) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { issueUpdate: { success: true, issue: { id: variables.issueId, state: IMPLEMENTATION_STATE } } } }),
      };
    }
    throw new Error(`the stand-in was sent a query it does not know: ${query.slice(0, 60)}`);
  };
  impl.calls = calls;
  return impl;
}

test('linearGraphQL has an app-token path: an access token goes out as `Bearer`, and a personal key still goes out raw', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push(opts.headers.Authorization);
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  };
  await linearGraphQL('query {}', {}, { accessToken: 'lin_oauth_abc', fetchImpl });
  await linearGraphQL('query {}', {}, { apiKey: 'lin_api_test123', fetchImpl });
  assert.deepEqual(seen, ['Bearer lin_oauth_abc', 'lin_api_test123']);
});

test('linearGraphQL still refuses a call with neither a personal key nor an app token', async () => {
  await assert.rejects(() => linearGraphQL('query {}', {}, {}), /apiKey is required/);
});

test('the real board writes as the app identity: every Linear call carries the app token as Bearer, and no personal key is ever sent', async () => {
  const fetchImpl = graphqlFetch();
  const board = createControllerBoard({ tokenProvider: appTokenProvider(), fetchImpl });

  await board.listReadyCards();
  await board.comment({ issueId: 'uuid-JUL-92', body: 'hello' });
  await board.moveCard({ issueId: 'uuid-JUL-92', to: 'Implementation' });

  assert.ok(fetchImpl.calls.length >= 4, 'the board made the calls it was asked for');
  for (const call of fetchImpl.calls) {
    assert.equal(call.authorization, `Bearer ${APP_TOKEN}`, `${call.query.slice(0, 40)} went out as the app`);
    assert.equal(call.url, 'https://api.linear.app/graphql');
  }
});

test('listReadyCards resolves the Ready column by name and returns the cards the eligibility rules need -- description included', async () => {
  const fetchImpl = graphqlFetch();
  const board = createControllerBoard({ tokenProvider: appTokenProvider(), fetchImpl });

  const cards = await board.listReadyCards();

  assert.equal(cards.length, 1);
  assert.equal(cards[0].identifier, 'JUL-92');
  assert.deepEqual(cards[0].labels, ['builder-claude-opus']);
  // The third refusal (no `## UAT plan`) reads the description. A board that
  // does not carry it would refuse every real card.
  assert.equal(cards[0].description, '## Acceptance criteria\n\n- [ ] It works.\n\n## UAT plan\n\n1. I look at it.\n');
  const states = fetchImpl.calls.find((call) => /ReadyQueueTeamStates/.test(call.query));
  assert.equal(states.variables.teamName, 'Julia-next');
  const listed = fetchImpl.calls.find((call) => /ReadyQueueIssues/.test(call.query));
  assert.equal(listed.variables.stateId, READY_STATE.id, 'the Ready column was resolved by name, not hard-coded');
});

test('moveCard resolves the target column by name and sets the state; an unknown column is an error, not a silent no-op', async () => {
  const fetchImpl = graphqlFetch();
  const board = createControllerBoard({ tokenProvider: appTokenProvider(), fetchImpl });

  await board.moveCard({ issueId: 'uuid-JUL-92', to: 'Implementation' });
  const move = fetchImpl.calls.find((call) => /ReadyQueueSetState/.test(call.query));
  assert.deepEqual(move.variables, { issueId: 'uuid-JUL-92', stateId: IMPLEMENTATION_STATE.id });

  await assert.rejects(
    () => board.moveCard({ issueId: 'uuid-JUL-92', to: 'Nowhere' }),
    /no column named Nowhere/,
  );
});

test('a refused call renews the app token and retries exactly once -- the board really is wired to createAuthedLinearCall', async () => {
  const inner = graphqlFetch();
  let refusals = 0;
  const fetchImpl = async (url, opts) => {
    // The first comment attempt is refused the way Linear refuses an expired
    // token: HTTP 401, which token.mjs's isAuthRefusal is the one reader of.
    if (/ReadyQueueComment/.test(JSON.parse(opts.body).query) && refusals === 0) {
      refusals += 1;
      inner.calls.push({ authorization: opts.headers.Authorization, query: 'ReadyQueueComment (refused)' });
      return { ok: false, status: 401, json: async () => ({ errors: [{ message: 'token expired' }] }) };
    }
    return inner(url, opts);
  };
  const board = createControllerBoard({ tokenProvider: appTokenProvider(), fetchImpl });

  const comment = await board.comment({ issueId: 'uuid-JUL-92', body: 'hello' });

  assert.equal(comment.id, 'c1', 'the retry succeeded');
  const commentCalls = inner.calls.filter((call) => /ReadyQueueComment/.test(call.query));
  assert.equal(commentCalls.length, 2, 'exactly one retry');
  assert.equal(commentCalls[0].authorization, `Bearer ${APP_TOKEN}`);
  assert.equal(commentCalls[1].authorization, `Bearer ${RENEWED_TOKEN}`, 'the retry used a freshly fetched token');
});

test('a token that is refused twice raises the second refusal instead of looping', async () => {
  const fetchImpl = async (url, opts) => {
    if (/ReadyQueueComment/.test(JSON.parse(opts.body).query)) {
      return { ok: false, status: 401, json: async () => ({ errors: [{ message: 'revoked' }] }) };
    }
    return graphqlFetch()(url, opts);
  };
  const board = createControllerBoard({ tokenProvider: appTokenProvider(), fetchImpl });
  await assert.rejects(() => board.comment({ issueId: 'uuid-JUL-92', body: 'hello' }), /401/);
});

test('a failed commentCreate is an error: the controller never reports a comment Linear did not accept', async () => {
  const fetchImpl = async (url, opts) => {
    if (/ReadyQueueComment/.test(JSON.parse(opts.body).query)) {
      return { ok: true, status: 200, json: async () => ({ data: { commentCreate: { success: false } } }) };
    }
    return graphqlFetch()(url, opts);
  };
  const board = createControllerBoard({ tokenProvider: appTokenProvider(), fetchImpl });
  await assert.rejects(() => board.comment({ issueId: 'uuid-JUL-92', body: 'hello' }), /commentCreate did not report success/);
});

// JUL-98 step 8: the worker-progress comment is ONE comment, edited in place.
test('updateComment edits one comment by id, as the app, and a failed edit is an error rather than a silent no-op', async () => {
  const sent = [];
  const answer = (success) => async (url, opts) => {
    const { query, variables } = JSON.parse(opts.body);
    if (/ReadyQueueCommentUpdate/.test(query)) {
      sent.push({ authorization: opts.headers.Authorization, variables, query });
      return { ok: true, status: 200, json: async () => ({ data: { commentUpdate: success ? { success: true, comment: { id: variables.id, url: 'u' } } : { success: false } } }) };
    }
    return graphqlFetch()(url, opts);
  };
  const board = createControllerBoard({ tokenProvider: appTokenProvider(), fetchImpl: answer(true) });
  const edited = await board.updateComment({ commentId: 'c7', body: 'now working -- the builder, round 1' });
  assert.equal(edited.id, 'c7');
  assert.deepEqual(sent[0].variables, { id: 'c7', body: 'now working -- the builder, round 1' });
  assert.equal(sent[0].authorization, `Bearer ${APP_TOKEN}`);
  assert.match(sent[0].query, /commentUpdate\(id: \$id, input: \{ body: \$body \}\)/);

  const refusing = createControllerBoard({ tokenProvider: appTokenProvider(), fetchImpl: answer(false) });
  await assert.rejects(() => refusing.updateComment({ commentId: 'c7', body: 'x' }), /commentUpdate did not report success for comment c7/);
});
