"""Linear, as the "Julia controller" OAuth app.

The client id and secret are systemd credentials (ops/julia-runner/README.md):
systemd-run decrypts them into $CREDENTIALS_DIRECTORY, readable only by this
process's account. They are read in-process and sent only to Linear's token
endpoint.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TOKEN_URL = 'https://api.linear.app/oauth/token'
API_URL = 'https://api.linear.app/graphql'

CARD_QUERY = """query Card($id: String!) {
  issue(id: $id) { id identifier title description labels { nodes { name } }
    comments(first: 250) { nodes { id body createdAt } } }
}"""
SETTINGS_QUERY = """query Settings($team: String!) {
  issues(filter: { team: { name: { eq: $team } }, labels: { name: { eq: "graph-settings" } } }, first: 2) {
    nodes { identifier description labels { nodes { name } } }
  }
}"""
COMMENT = """mutation Comment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id } }
}"""
# With an id the caller chose: Linear refuses a second comment with the same id
# ("conflict on insert of Comment", checked live on JUL-150, 25 Sep), so the
# same comment can never be posted twice, however late Linear lists it.
COMMENT_WITH_ID = """mutation Comment($id: String!, $issueId: String!, $body: String!) {
  commentCreate(input: { id: $id, issueId: $issueId, body: $body }) { success comment { id } }
}"""
DUPLICATE_ID = 'conflict on insert of Comment'


class AlreadyPosted(Exception):
    """Linear already has a comment with this id."""
READY_QUERY = """query Ready($team: String!, $state: String!, $after: String) {
  issues(filter: { team: { name: { eq: $team } }, state: { name: { eq: $state } } }, first: 100, after: $after) {
    nodes {
      identifier title description sortOrder
      labels { nodes { name } }
      inverseRelations(first: 250) { nodes { type issue { identifier state { name type } } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}"""
IN_PROGRESS_QUERY = """query InProgress($team: String!, $after: String) {
  issues(filter: { team: { name: { eq: $team } }, state: { name: { eq: "Implementation" } } },
         first: 100, after: $after) {
    nodes { identifier }
    pageInfo { hasNextPage endCursor }
  }
}"""
WATCH_CARD_QUERY = """query WatchCard($id: String!) {
  issue(id: $id) {
    id identifier description state { name } assignee { id }
    labels { nodes { name } }
    inverseRelations(first: 250) { nodes { type issue { identifier state { name type } } } }
    comments(first: 250) { nodes { body createdAt } pageInfo { hasNextPage endCursor } }
  }
}"""
WATCH_COMMENTS_QUERY = """query WatchComments($id: String!, $after: String) {
  issue(id: $id) {
    comments(first: 250, after: $after) {
      nodes { body createdAt }
      pageInfo { hasNextPage endCursor }
    }
  }
}"""
TODD_ID = 'a55c040c-d281-4382-8e66-c23ab7346919'
STATES_QUERY = """query States($id: String!) {
  issue(id: $id) { id team { states { nodes { id name } } } }
}"""
MOVE = """mutation Move($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}"""
EDIT = """mutation Edit($id: String!, $body: String!) {
  commentUpdate(id: $id, input: { body: $body }) { success }
}"""
ASSIGN = """mutation Assign($id: String!, $assigneeId: String) {
  issueUpdate(id: $id, input: { assigneeId: $assigneeId }) { success }
}"""
# The only person the graph ever assigns a card to (JUL-128 AC 5).
TODD_NAME = 'Todd Wyder'
USERS_QUERY = """query Users {
  users { nodes { id name } }
}"""


def read_credential(directory: str | None = None) -> tuple[str, str]:
    directory = directory or os.environ.get('CREDENTIALS_DIRECTORY')
    if not directory:
        raise RuntimeError('the Linear app credential is not available: start the graph with systemd-run and '
                           'LoadCredentialEncrypted=linear-app-id and linear-app-secret')
    read = lambda name: (Path(directory) / name).read_text().rstrip('\n')
    return read('linear-app-id'), read('linear-app-secret')


def _post(url: str, data: bytes, headers: dict) -> dict:
    request = urllib.request.Request(url, data=data, headers=headers, method='POST')
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


TEAM = 'Julia-next'
# The app's token lives 30 days (graph/controller/token.mjs). A long-running
# graph fetches a new one well before that, and at once if Linear refuses it.
TOKEN_RENEW_SECONDS = 24 * 60 * 60


def sort_order(value) -> float:
    """Board order; a card with no sortOrder goes last (scripts/ready-queue.mjs sortOrderOf)."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return float('inf')
    return number if number == number else float('inf')  # NaN goes last too


def blocker(relation: dict) -> dict:
    """A blocker Linear only half returns (deleted, or no state) still counts as
    open, as in scripts/ready-queue.mjs: the card waits rather than starting blocked."""
    issue = relation.get('issue') or {}
    state = issue.get('state') or {}
    return {'identifier': issue.get('identifier') or 'an unknown card', 'state': state.get('name') or 'unknown state',
            'type': state.get('type') or ''}


def ready_card(issue: dict) -> dict:
    """A Ready card in the board check's shape. Linear keeps a blocking relation
    on the blocker (type "blocks"), so the blocked card sees it among its
    inverse relations, with the blocker as `issue` (live-verified for JUL-79)."""
    return {
        'identifier': issue['identifier'], 'title': issue['title'], 'description': issue['description'] or '',
        'sort_order': sort_order(issue.get('sortOrder')),
        'labels': [label['name'] for label in (issue.get('labels') or {}).get('nodes', [])],
        'blockers': [blocker(r) for r in (issue.get('inverseRelations') or {}).get('nodes', []) if r.get('type') == 'blocks'],
    }


class LinearApp:
    def __init__(self, clock=time.monotonic):
        self._token = None
        self._token_at = 0.0
        self._clock = clock
        self._ids: dict[str, str] = {}

    def _fresh_token(self) -> str:
        if not self._token or self._clock() - self._token_at >= TOKEN_RENEW_SECONDS:
            client_id, secret = read_credential()
            body = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': client_id,
                                           'client_secret': secret, 'scope': 'comments:create read write',
                                           'actor': 'app'}).encode()
            token = _post(TOKEN_URL, body, {'Content-Type': 'application/x-www-form-urlencoded'}).get('access_token')
            if not token:
                raise RuntimeError('Linear returned no access token for the app credential')
            self._token, self._token_at = token, self._clock()
        return self._token

    def _call(self, query: str, variables: dict) -> dict:
        for attempt in (1, 2):
            try:
                reply = _post(API_URL, json.dumps({'query': query, 'variables': variables}).encode(),
                              {'Content-Type': 'application/json', 'Authorization': f'Bearer {self._fresh_token()}'})
            except urllib.error.HTTPError as error:
                if error.code == 401 and attempt == 1:
                    self._token = None  # expired or revoked: fetch a new one and try once more
                    continue
                raise
            errors = reply.get('errors') or []
            if attempt == 1 and any((e.get('extensions') or {}).get('code') == 'AUTHENTICATION_ERROR' for e in errors):
                self._token = None
                continue
            if errors:
                raise RuntimeError(f"Linear refused the request: {errors[0].get('message')}")
            return reply['data']

    async def card(self, card: str) -> dict:
        issue = (await asyncio.to_thread(self._call, CARD_QUERY, {'id': card}))['issue']
        self._ids[card] = issue['id']
        comments = sorted(issue['comments']['nodes'], key=lambda c: c['createdAt'])
        return {'identifier': issue['identifier'], 'title': issue['title'], 'description': issue['description'] or '',
                'labels': [label['name'] for label in issue['labels']['nodes']],
                'comments': [{'id': c['id'], 'body': c['body']} for c in comments]}

    async def settings(self) -> dict:
        nodes = (await asyncio.to_thread(self._call, SETTINGS_QUERY, {'team': TEAM}))['issues']['nodes']
        if len(nodes) != 1:
            raise RuntimeError(f'expected one Graph Settings card in Linear, found {len(nodes)}')
        issue = nodes[0]
        return {'description': issue['description'] or '',
                'labels': [label['name'] for label in issue['labels']['nodes']]}

    async def ready_cards(self) -> list[dict]:
        cards, after, seen = [], None, set()
        while True:
            page = (await asyncio.to_thread(self._call, READY_QUERY, {'team': TEAM, 'state': 'Ready', 'after': after}))['issues']
            cards += [ready_card(issue) for issue in page['nodes']]
            if not page['pageInfo']['hasNextPage']:
                return cards
            after = page['pageInfo']['endCursor']
            if not after or after in seen:
                raise RuntimeError('Linear reported another page of Ready cards but gave no new cursor')
            seen.add(after)

    async def in_progress_cards(self) -> list[dict]:
        cards, after, seen = [], None, set()
        while True:
            page = (await asyncio.to_thread(self._call, IN_PROGRESS_QUERY, {'team': TEAM, 'after': after}))['issues']
            cards += page['nodes']
            if not page['pageInfo']['hasNextPage']:
                return cards
            after = page['pageInfo']['endCursor']
            if not after or after in seen:
                raise RuntimeError('Linear reported another page of Implementation cards but gave no new cursor')
            seen.add(after)

    async def watchdog_card(self, card: str) -> dict:
        issue = (await asyncio.to_thread(self._call, WATCH_CARD_QUERY, {'id': card}))['issue']
        if issue is None:
            raise RuntimeError(f'{card} disappeared from Linear')
        comments = issue['comments']
        nodes, seen = list(comments['nodes']), set()
        while comments['pageInfo']['hasNextPage']:
            after = comments['pageInfo']['endCursor']
            if not after or after in seen:
                raise RuntimeError(f'Linear reported another page of {card} comments but gave no new cursor')
            seen.add(after)
            comments = (await asyncio.to_thread(self._call, WATCH_COMMENTS_QUERY,
                                                {'id': issue['id'], 'after': after}))['issue']['comments']
            nodes += comments['nodes']
        result = ready_card({**issue, 'title': '', 'sortOrder': 0})
        result.update(state=issue['state']['name'], assignee_id=(issue.get('assignee') or {}).get('id'),
                      comments=sorted(nodes, key=lambda c: c['createdAt']))
        self._ids[card] = issue['id']
        return result

    async def assign_todd(self, card: str) -> None:
        fresh = await self.watchdog_card(card)
        if fresh['assignee_id'] == TODD_ID:
            return
        await self.assign_to_todd(card)

    async def move(self, card: str, state: str) -> None:
        issue = (await asyncio.to_thread(self._call, STATES_QUERY, {'id': card}))['issue']
        state_id = next((s['id'] for s in issue['team']['states']['nodes'] if s['name'] == state), None)
        if state_id is None:
            raise RuntimeError(f'the team has no "{state}" column')
        data = await asyncio.to_thread(self._call, MOVE, {'id': issue['id'], 'stateId': state_id})
        if not data['issueUpdate']['success']:
            raise RuntimeError(f'Linear did not move {card} to {state}')

    async def comment(self, card: str, body: str, comment_id: str | None = None) -> str:
        """Post a comment; with comment_id, raise AlreadyPosted if Linear has it already."""
        if card not in self._ids:
            await self.card(card)
        if comment_id is None:
            data = await asyncio.to_thread(self._call, COMMENT, {'issueId': self._ids[card], 'body': body})
        else:
            try:
                data = await asyncio.to_thread(self._call, COMMENT_WITH_ID,
                                               {'id': comment_id, 'issueId': self._ids[card], 'body': body})
            except RuntimeError as error:
                if DUPLICATE_ID in str(error):
                    raise AlreadyPosted(comment_id) from None
                raise
        if not data['commentCreate']['success']:
            raise RuntimeError(f'Linear did not accept the comment on {card}')
        return data['commentCreate']['comment']['id']

    async def edit(self, comment_id: str, body: str) -> None:
        data = await asyncio.to_thread(self._call, EDIT, {'id': comment_id, 'body': body})
        if not data['commentUpdate']['success']:
            raise RuntimeError(f'Linear did not accept the edit to comment {comment_id}')

    async def assign_to_todd(self, card: str) -> None:
        """Assign the card to Todd, found by his exact name; never anyone else."""
        if card not in self._ids:
            await self.card(card)
        users = (await asyncio.to_thread(self._call, USERS_QUERY, {}))['users']['nodes']
        todd = [u['id'] for u in users if u.get('name') == TODD_NAME]
        if len(todd) != 1:
            raise RuntimeError(f'{len(todd)} Linear users are named {TODD_NAME!r}, so the card was not assigned')
        data = await asyncio.to_thread(self._call, ASSIGN, {'id': self._ids[card], 'assigneeId': todd[0]})
        if not data['issueUpdate']['success']:
            raise RuntimeError(f'Linear did not accept assigning {card} to {TODD_NAME}')
