import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgyDeliverySpec, parseAgyDeliveryResult, parseAgyDeliveryModelLog,
} from './run-agy-seat.mjs';

test('delivery recovery uses the current default model and records the model agy actually reports', () => {
  const spec = buildAgyDeliverySpec('review this recovery fix', { cwd: 'C:\\recovery', logFile: 'C:\\evidence\\agy.log' });
  assert.equal(spec.command, 'agy');
  assert.equal(spec.args.includes('--model'), false);
  assert.deepEqual(spec.args.slice(-4), ['--log-file', 'C:\\evidence\\agy.log', '--print', 'review this recovery fix']);
  assert.deepEqual(spec.options, { cwd: 'C:\\recovery' });
  const parsed = parseAgyDeliveryResult([
    JSON.stringify({ event: 'init', conversation_id: 'conversation-1', init: { cwd: 'C:\\recovery' } }),
    JSON.stringify({ event: 'result', result: { conversation_id: 'conversation-1', status: 'SUCCESS', response: 'VERDICT: PASS' } }),
  ].join('\n'));
  assert.deepEqual(parsed, { ok: true, errorText: null, response: 'VERDICT: PASS', model: null, conversationId: 'conversation-1', usage: null });
  const model = parseAgyDeliveryModelLog([
    'I1013 09:34:52.880047 1 model_resolver.go:107] Resolving model gemini-3.8-flash-medium',
    'I1013 09:34:53.765010 1 server.go:1219] Created conversation conversation-1',
  ].join('\n'), parsed.conversationId);
  assert.equal(model, 'gemini-3.8-flash-medium');
});

test('delivery model evidence rejects an ambiguous or unrelated agy log', () => {
  assert.equal(parseAgyDeliveryModelLog('Resolving model gemini-a\nResolving model gemini-b\nCreated conversation conversation-1', 'conversation-1'), null);
  assert.equal(parseAgyDeliveryModelLog('Resolving model gemini-a\nCreated conversation another-conversation', 'conversation-1'), null);
});

test('delivery result rejects incomplete, denied, and mismatched turns', () => {
  const denied = [
    JSON.stringify({ event: 'init', conversation_id: 'one', init: {} }),
    JSON.stringify({ event: 'result', result: { conversation_id: 'one', status: 'SUCCESS', response: 'done', denied_actions: ['write'] } }),
  ].join('\n');
  assert.equal(parseAgyDeliveryResult(denied).ok, false);
  assert.equal(parseAgyDeliveryResult('not json').ok, false);
  const mismatch = [
    JSON.stringify({ event: 'init', conversation_id: 'one', init: {} }),
    JSON.stringify({ event: 'result', result: { conversation_id: 'two', status: 'SUCCESS', response: 'done' } }),
  ].join('\n');
  assert.equal(parseAgyDeliveryResult(mismatch).ok, false);
});
