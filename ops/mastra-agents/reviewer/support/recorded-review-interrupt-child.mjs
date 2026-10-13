import { join } from 'node:path';
import { createReviewerReportRecorder } from '../src/reviewer-report.mjs';
import { durableWrite } from '../src/recording-engine.mjs';

const runDirectory = process.argv[2];
const failurePath = join(runDirectory, 'verdict.json.failure.json');
const candidate = 'a'.repeat(40);
const evidence = [{ source: 'diff', quote: 'known quote', reasoning: 'known reason' }];
const input = {
  candidate, digest: 'digest', files: ['a.mjs'], criteria: ['criterion'],
  sources: { diff: 'known quote', 'file:a.mjs': 'known quote', 'test-evidence': 'known quote' },
  scope: { kind: 'initial' },
};
const recorder = await createReviewerReportRecorder({
  input, repoRoot: runDirectory, commit: candidate, runDirectory,
  onProgress: acceptedPieces => durableWrite(failurePath, `${JSON.stringify({
    kind: 'technical-failure', reason: 'reviewer interrupted before submit_report completed', acceptedPieces,
  })}\n`),
  submit: async () => ({ accepted: true }),
});

for (const piece of [
  { type: 'header', verdict: 'INCONCLUSIVE', summary: 'summary', approach: 'approach' },
  { type: 'axis', axis: 'standards', status: 'proven', evidence },
  { type: 'axis', axis: 'spec', status: 'proven', evidence },
]) {
  const result = await recorder.tools.record_piece.execute(piece);
  if (result.accepted !== true) throw new Error(`fixture piece was not accepted: ${JSON.stringify(result)}`);
}
process.send?.('durable-pieces-recorded');
setInterval(() => {}, 1_000);
