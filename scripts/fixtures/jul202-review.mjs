// Deterministic reports for controller tests, never independent approval.
import { reviewInput } from '../julia-delivery-review.mjs';
import { sha256 } from '../julia-delivery-state.mjs';

export function fixtureInput(card, candidate) {
  const input = reviewInput(card, candidate);
  input.files = ['fixture.mjs'];
  input.sources['file:fixture.mjs'] = 'deliberate deterministic candidate fixture';
  input.sources['test-evidence'] = 'explicit checked fixture output, no provider or substantive review proof';
  delete input.digest; input.digest = sha256(JSON.stringify(input));
  return input;
}

export function fixtureReport(input, verdict = 'PASS', summary = 'scripted stand-in, not independent review') {
  const evidence = [input.files.length ? `file:${input.files[0]}` : 'diff', 'test-evidence'].map(source => ({ source, quote: input.sources[source], reasoning: 'Deterministic controller fixture only; no provider or semantic approval is claimed.' }));
  const status = verdict === 'FAIL' ? 'failed' : 'proven';
  return `VERDICT: ${verdict}\nREVIEW: ` + JSON.stringify({
    candidate: input.candidate, inputDigest: input.digest, approach: 'Independent approach is scripted for this controller fixture.',
    standards: { status, evidence }, spec: { status, evidence },
    criteria: input.criteria.map(criterion => ({ criterion, status, evidence })),
    files: input.files.map(file => ({ file, status, evidence: [{ source: `file:${file}`, quote: input.sources[`file:${file}`], reasoning: 'Explicit scripted coverage for controller tests only.' }] })),
    checks: [1, 2, 3, 4, 5].map(check => ({ check, status: 'proven', evidence })),
    counterexamples: ['missing result', 'incorrect candidate'].map(scenario => ({ scenario, method: 'fixture trace', result: 'Scripted for controller tests only.', evidence })),
    testAudit: { analysis: 'This fixture exercises control flow and does not establish test discrimination or provider behavior.', evidence },
    findings: verdict === 'FAIL' ? [{ file: input.files[0], location: '1', requirement: input.criteria[0], scenario: summary, mechanism: 'deliberate fixture failure', consequence: 'scripted behavior fails', repair: 'Repair the scripted failure.', evidence }] : [], limitations: [],
  });
}

// Existing recovery tests retain their original scenarios. Replace only their
// scripted bare verdicts with explicit evidence-contract fixtures.
export function fixtureLaunch(launch) {
  return async (role, request) => {
    const result = await launch(role, request);
    if (role !== 'reviewer' || !/^VERDICT: (PASS|FAIL)\n/.test(result?.text ?? '')) return result;
    return { ...result, text: fixtureReport(request.reviewInput, result.text.startsWith('VERDICT: FAIL') ? 'FAIL' : 'PASS', result.text) };
  };
}

export function fixtureAdapters(adapters) {
  return { ...adapters, prepareReview: fixtureInput, launch: fixtureLaunch(adapters.launch) };
}
