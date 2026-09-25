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
import urllib.parse
import urllib.request
from pathlib import Path

TOKEN_URL = 'https://api.linear.app/oauth/token'
API_URL = 'https://api.linear.app/graphql'

CARD_QUERY = """query Card($id: String!) {
  issue(id: $id) { id identifier title description comments(first: 250) { nodes { id body createdAt } } }
}"""
COMMENT = """mutation Comment($issueId: String!, $body: String!) {
  commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id } }
}"""
READY_QUERY = """query Ready($team: String!, $state: String!, $after: String) {
  issues(filter: { team: { name: { eq: $team } }, state: { name: { eq: $state } } }, first: 100, after: $after) {
    nodes {
      identifier title description sortOrder
      labels { nodes { name } }
      inverseRelations { nodes { type issue { identifier state { name type } } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}"""
STATES_QUERY = """query States($id: String!) {
  issue(id: $id) { id team { states { nodes { id name } } } }
}"""
MOVE = """mutation Move($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) { success }
}"""
EDIT = """mutation Edit($id: String!, $body: String!) {
  commentUpdate(id: $id, input: { body: $body }) { success }
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


def ready_card(issue: dict) -> dict:
    """A Ready card in the board check's shape. Linear keeps a blocking relation
    on the blocker (type "blocks"), so the blocked card sees it among its
    inverse relations, with the blocker as `issue` (live-verified for JUL-79)."""
    return {
        'identifier': issue['identifier'], 'title': issue['title'], 'description': issue['description'] or '',
        'sort_order': float(issue['sortOrder']),
        'labels': [label['name'] for label in issue['labels']['nodes']],
        'blockers': [{'identifier': r['issue']['identifier'], 'state': r['issue']['state']['name'],
                      'type': r['issue']['state']['type']}
                     for r in issue['inverseRelations']['nodes'] if r['type'] == 'blocks'],
    }


class LinearApp:
    def __init__(self):
        self._token = None
        self._ids: dict[str, str] = {}

    def _call(self, query: str, variables: dict) -> dict:
        if not self._token:
            client_id, secret = read_credential()
            body = urllib.parse.urlencode({'grant_type': 'client_credentials', 'client_id': client_id,
                                           'client_secret': secret, 'scope': 'comments:create read write',
                                           'actor': 'app'}).encode()
            self._token = _post(TOKEN_URL, body, {'Content-Type': 'application/x-www-form-urlencoded'}).get('access_token')
            if not self._token:
                raise RuntimeError('Linear returned no access token for the app credential')
        reply = _post(API_URL, json.dumps({'query': query, 'variables': variables}).encode(),
                      {'Content-Type': 'application/json', 'Authorization': f'Bearer {self._token}'})
        if reply.get('errors'):
            raise RuntimeError(f"Linear refused the request: {reply['errors'][0].get('message')}")
        return reply['data']

    async def card(self, card: str) -> dict:
        issue = (await asyncio.to_thread(self._call, CARD_QUERY, {'id': card}))['issue']
        self._ids[card] = issue['id']
        comments = sorted(issue['comments']['nodes'], key=lambda c: c['createdAt'])
        return {'identifier': issue['identifier'], 'title': issue['title'], 'description': issue['description'] or '',
                'comments': [{'id': c['id'], 'body': c['body']} for c in comments]}

    async def ready_cards(self) -> list[dict]:
        cards, after = [], None
        while True:
            page = (await asyncio.to_thread(self._call, READY_QUERY, {'team': TEAM, 'state': 'Ready', 'after': after}))['issues']
            cards += [ready_card(issue) for issue in page['nodes']]
            if not page['pageInfo']['hasNextPage']:
                return cards
            after = page['pageInfo']['endCursor']

    async def move(self, card: str, state: str) -> None:
        issue = (await asyncio.to_thread(self._call, STATES_QUERY, {'id': card}))['issue']
        state_id = next((s['id'] for s in issue['team']['states']['nodes'] if s['name'] == state), None)
        if state_id is None:
            raise RuntimeError(f'the team has no "{state}" column')
        data = await asyncio.to_thread(self._call, MOVE, {'id': issue['id'], 'stateId': state_id})
        if not data['issueUpdate']['success']:
            raise RuntimeError(f'Linear did not move {card} to {state}')

    async def comment(self, card: str, body: str) -> str:
        if card not in self._ids:
            await self.card(card)
        data = await asyncio.to_thread(self._call, COMMENT, {'issueId': self._ids[card], 'body': body})
        if not data['commentCreate']['success']:
            raise RuntimeError(f'Linear did not accept the comment on {card}')
        return data['commentCreate']['comment']['id']

    async def edit(self, comment_id: str, body: str) -> None:
        data = await asyncio.to_thread(self._call, EDIT, {'id': comment_id, 'body': body})
        if not data['commentUpdate']['success']:
            raise RuntimeError(f'Linear did not accept the edit to comment {comment_id}')
