"""The Linear app client: its token is renewed, and a bad page cursor stops the read."""

from __future__ import annotations

import asyncio
import io
import json
import unittest
import urllib.error
from unittest import mock

from julia_graph import linear


def refused(url):
    return urllib.error.HTTPError(url, 401, 'Unauthorized', {}, io.BytesIO(b''))


class PretendLinearServer:
    def __init__(self):
        self.tokens = 0
        self.valid: set[str] = set()
        self.pages: list[dict] = []
        self.comment_ids: set[str] = set()  # as Linear: a comment id is never taken twice

    def post(self, url, data, headers):
        if url == linear.TOKEN_URL:
            self.tokens += 1
            token = f't{self.tokens}'
            self.valid.add(token)
            return {'access_token': token}
        if headers['Authorization'].split()[-1] not in self.valid:
            raise refused(url)
        request = json.loads(data)
        if 'query Ready' in request['query']:
            return {'data': {'issues': self.pages.pop(0)}}
        if 'query Card' in request['query']:
            return {'data': {'issue': {'id': 'uuid-1', 'identifier': 'JUL-1', 'title': 'T', 'description': '',
                                       'labels': {'nodes': []}, 'comments': {'nodes': []}}}}
        if 'commentCreate' in request['query']:
            chosen = request['variables'].get('id')
            if chosen in self.comment_ids:  # Linear's own reply, seen live on JUL-150 (25 Sep)
                return {'data': None, 'errors': [{'message': 'conflict on insert of Comment',
                                                  'extensions': {'code': 'INPUT_ERROR', 'type': 'invalid input'}}]}
            self.comment_ids.add(chosen)
            return {'data': {'commentCreate': {'success': True, 'comment': {'id': chosen or 'generated'}}}}
        return {'data': {'ok': True}}


def card(n):
    return {'identifier': f'JUL-{n}', 'title': 'T', 'description': '', 'sortOrder': n,
            'labels': {'nodes': []}, 'inverseRelations': {'nodes': []}}


class LinearAppTest(unittest.TestCase):
    def setUp(self):
        self.server = PretendLinearServer()
        self.now = 0.0
        for patch in (mock.patch.object(linear, '_post', self.server.post),
                      mock.patch.object(linear, 'read_credential', lambda: ('id', 'secret'))):
            patch.start()
            self.addCleanup(patch.stop)
        self.app = linear.LinearApp(clock=lambda: self.now)

    def test_the_token_is_renewed_before_it_can_expire(self):
        self.app._call('query Q { ok }', {})
        self.now += linear.TOKEN_RENEW_SECONDS - 1
        self.app._call('query Q { ok }', {})
        self.assertEqual(self.server.tokens, 1)
        self.now += 2
        self.app._call('query Q { ok }', {})
        self.assertEqual(self.server.tokens, 2)

    def test_a_refused_token_is_replaced_and_the_call_tried_once_more(self):
        self.app._call('query Q { ok }', {})
        self.server.valid.clear()  # expired or revoked early
        self.assertEqual(self.app._call('query Q { ok }', {}), {'ok': True})
        self.assertEqual(self.server.tokens, 2)

    def test_an_authentication_error_in_the_reply_also_renews_the_token(self):
        replies = [{'errors': [{'message': 'Authentication required', 'extensions': {'code': 'AUTHENTICATION_ERROR'}}]},
                   {'data': {'ok': True}}]

        def post(url, data, headers):
            return {'access_token': 'x'} if url == linear.TOKEN_URL else replies.pop(0)
        with mock.patch.object(linear, '_post', post):
            self.assertEqual(self.app._call('query Q { ok }', {}), {'ok': True})

    def test_a_token_refused_twice_is_an_error(self):
        def always_refused(url, data, headers):
            if url == linear.TOKEN_URL:
                return {'access_token': 'x'}
            raise refused(url)
        with mock.patch.object(linear, '_post', always_refused):
            with self.assertRaises(urllib.error.HTTPError):
                self.app._call('query Q { ok }', {})

    def test_a_comment_with_an_id_linear_already_has_is_already_posted(self):
        self.assertEqual(asyncio.run(self.app.comment('JUL-1', 'hello', '6f1c0e5a-1b2c-4d3e-8f40-0a1b2c3d4e5f')),
                         '6f1c0e5a-1b2c-4d3e-8f40-0a1b2c3d4e5f')
        with self.assertRaises(linear.AlreadyPosted):
            asyncio.run(self.app.comment('JUL-1', 'hello', '6f1c0e5a-1b2c-4d3e-8f40-0a1b2c3d4e5f'))
        # without an id, any refusal is still an error, never "already posted"
        self.assertEqual(asyncio.run(self.app.comment('JUL-1', 'no id')), 'generated')

    def test_ready_cards_walks_every_page(self):
        self.server.pages = [{'nodes': [card(1)], 'pageInfo': {'hasNextPage': True, 'endCursor': 'a'}},
                             {'nodes': [card(2)], 'pageInfo': {'hasNextPage': False, 'endCursor': 'b'}}]
        self.assertEqual([c['identifier'] for c in asyncio.run(self.app.ready_cards())], ['JUL-1', 'JUL-2'])

    def test_a_page_cursor_that_does_not_move_stops_the_read(self):
        self.server.pages = [{'nodes': [card(1)], 'pageInfo': {'hasNextPage': True, 'endCursor': 'a'}},
                             {'nodes': [card(1)], 'pageInfo': {'hasNextPage': True, 'endCursor': 'a'}}]
        with self.assertRaisesRegex(RuntimeError, 'no new cursor'):
            asyncio.run(self.app.ready_cards())

    def test_page_cursors_that_go_round_in_a_circle_stop_the_read(self):
        page = lambda cursor: {'nodes': [card(1)], 'pageInfo': {'hasNextPage': True, 'endCursor': cursor}}
        self.server.pages = [page('a'), page('b'), page('a'), page('b')]
        with self.assertRaisesRegex(RuntimeError, 'no new cursor'):
            asyncio.run(self.app.ready_cards())
        self.assertEqual(len(self.server.pages), 1)  # stopped at the first repeat
