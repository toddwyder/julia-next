import { z } from 'zod/v4';
import { checkedReview } from '../../../../scripts/julia-delivery-review.mjs';
import { requireCompleteFileReview } from './contract.mjs';
import { evidenceCitations, repairSerializedEvidenceQuotes, verifyEvidenceQuote } from './quote-check.mjs';
import { createRecordingEngine } from './recording-engine.mjs';

const Evidence = z.object({ source: z.string().min(1), quote: z.string().min(1), reasoning: z.string().min(1) });
const EvidenceList = z.array(Evidence).min(1);
const Status = z.enum(['proven', 'failed', 'unverified']);
const Supported = z.object({ status: Status, evidence: EvidenceList });
const Finding = z.object({
  problemId: z.string().min(1).optional(), file: z.string().min(1), location: z.string().min(1), requirement: z.string().min(1),
  scenario: z.string().min(1), mechanism: z.string().min(1), consequence: z.string().min(1), repair: z.string().min(1), evidence: EvidenceList,
});
const FileReview = z.object({ file: z.string().min(1), status: Status, evidence: EvidenceList });
const RegressionReview = z.object({ file: z.string().min(1), status: Status, evidence: EvidenceList });
const CriterionReview = z.object({ criterion: z.string().min(1), status: Status, evidence: EvidenceList });
const CheckReview = z.object({ check: z.number().int().min(1).max(5), status: z.enum(['proven', 'failed', 'unverified', 'not-applicable']), evidence: EvidenceList, reason: z.string().optional() });
const Counterexample = z.object({ scenario: z.string().min(1), method: z.string().min(1), result: z.string().min(1), evidence: EvidenceList });
const TestAudit = z.object({ analysis: z.string().min(1), evidence: EvidenceList });
const InitialReport = z.object({
  filesReviewed: z.array(z.string()).min(1), candidate: z.string().min(1), inputDigest: z.string().min(1), summary: z.string().min(1), approach: z.string().min(1),
  standards: Supported, spec: Supported,
  criteria: z.array(CriterionReview),
  files: z.array(FileReview),
  checks: z.array(CheckReview),
  counterexamples: z.array(Counterexample).min(2),
  testAudit: TestAudit, findings: z.array(Finding), limitations: z.array(z.string()),
});
const RepairReport = z.object({
  filesReviewed: z.array(z.string()).min(1), candidate: z.string().min(1), inputDigest: z.string().min(1), summary: z.string().min(1),
  repairedFindings: z.array(z.object({ id: z.string().min(1), status: Status, evidence: EvidenceList })),
  regressions: z.array(RegressionReview), findings: z.array(Finding.omit({ problemId: true })), limitations: z.array(z.string()),
});

export const reviewedFilesSchema = files => z.array(z.enum(files)).length(files.length);

export const envelopeFor = input => {
  const exactFiles = reviewedFilesSchema(input.files);
  const report = input.scope?.kind === 'repair'
    ? RepairReport.extend({
      filesReviewed: exactFiles,
      regressions: z.array(RegressionReview.extend({ file: z.enum(input.scope.files) })).length(input.scope.files.length),
    })
    : InitialReport.extend({ filesReviewed: exactFiles, files: z.array(FileReview.extend({ file: z.enum(input.files) })).length(input.files.length) });
  return z.object({ verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), report });
};

const completePiece = z.object({ type: z.literal('collection-complete'), collection: z.enum(['counterexamples', 'findings', 'limitations']) });

function initialPieceSchema(input) {
  const allowedFile = z.enum(input.files);
  const allowedCriterion = z.enum(input.criteria);
  return z.discriminatedUnion('type', [
    z.object({ type: z.literal('header'), verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), summary: z.string().min(1), approach: z.string().min(1) }),
    Supported.extend({ type: z.literal('axis'), axis: z.enum(['standards', 'spec']) }),
    CriterionReview.extend({ type: z.literal('criterion'), criterion: allowedCriterion }),
    FileReview.extend({ type: z.literal('file'), file: allowedFile }),
    CheckReview.extend({ type: z.literal('check') }),
    Counterexample.extend({ type: z.literal('counterexample'), index: z.number().int().min(0) }),
    TestAudit.extend({ type: z.literal('test-audit') }),
    Finding.extend({ type: z.literal('finding'), index: z.number().int().min(0), file: allowedFile }),
    z.object({ type: z.literal('limitation'), index: z.number().int().min(0), text: z.string().min(1) }),
    completePiece,
  ]);
}

function repairPieceSchema(input) {
  const allowedFile = z.enum(input.scope.files);
  const findingIds = input.scope.findings.map(finding => finding.id);
  return z.discriminatedUnion('type', [
    z.object({ type: z.literal('header'), verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), summary: z.string().min(1) }),
    Supported.extend({ type: z.literal('repaired-finding'), id: z.enum(findingIds) }),
    RegressionReview.extend({ type: z.literal('regression'), file: allowedFile }),
    Finding.omit({ problemId: true }).extend({ type: z.literal('finding'), index: z.number().int().min(0), file: allowedFile }),
    z.object({ type: z.literal('limitation'), index: z.number().int().min(0), text: z.string().min(1) }),
    z.object({ type: z.literal('collection-complete'), collection: z.enum(['findings', 'limitations']) }),
  ]);
}

function pieceKey(piece) {
  switch (piece.type) {
    case 'header': case 'test-audit': return piece.type;
    case 'axis': return `axis:${piece.axis}`;
    case 'criterion': return `criterion:${piece.criterion}`;
    case 'file': case 'regression': return `${piece.type}:${piece.file}`;
    case 'check': return `check:${piece.check}`;
    case 'counterexample': case 'finding': case 'limitation': return `${piece.type}:${piece.index}`;
    case 'collection-complete': return `complete:${piece.collection}`;
    case 'repaired-finding': return `repaired-finding:${piece.id}`;
    default: throw new Error(`unknown report piece ${piece.type}`);
  }
}

const without = (value, fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));
const valuesOfType = (pieces, type) => [...pieces.values()].filter(piece => piece.type === type);
const byIndex = (left, right) => left.index - right.index;

function assembleInitial(input, pieces) {
  const header = pieces.get('header');
  return {
    verdict: header.verdict,
    report: {
      filesReviewed: input.files,
      candidate: input.candidate,
      inputDigest: input.digest,
      summary: header.summary,
      approach: header.approach,
      standards: without(pieces.get('axis:standards'), ['type', 'axis']),
      spec: without(pieces.get('axis:spec'), ['type', 'axis']),
      criteria: input.criteria.map(criterion => without(pieces.get(`criterion:${criterion}`), ['type'])),
      files: input.files.map(file => without(pieces.get(`file:${file}`), ['type'])),
      checks: [1, 2, 3, 4, 5].map(check => without(pieces.get(`check:${check}`), ['type'])),
      counterexamples: valuesOfType(pieces, 'counterexample').sort(byIndex).map(piece => without(piece, ['type', 'index'])),
      testAudit: without(pieces.get('test-audit'), ['type']),
      findings: valuesOfType(pieces, 'finding').sort(byIndex).map(piece => without(piece, ['type', 'index'])),
      limitations: valuesOfType(pieces, 'limitation').sort(byIndex).map(piece => piece.text),
    },
  };
}

function assembleRepair(input, pieces) {
  const header = pieces.get('header');
  return {
    verdict: header.verdict,
    report: {
      filesReviewed: input.files,
      candidate: input.candidate,
      inputDigest: input.digest,
      summary: header.summary,
      repairedFindings: input.scope.findings.map(({ id }) => without(pieces.get(`repaired-finding:${id}`), ['type'])),
      regressions: input.scope.files.map(file => without(pieces.get(`regression:${file}`), ['type'])),
      findings: valuesOfType(pieces, 'finding').sort(byIndex).map(piece => without(piece, ['type', 'index'])),
      limitations: valuesOfType(pieces, 'limitation').sort(byIndex).map(piece => piece.text),
    },
  };
}

function requiredInitial(input) {
  return [
    'header', 'axis:standards', 'axis:spec',
    ...input.criteria.map(value => `criterion:${value}`),
    ...input.files.map(value => `file:${value}`),
    ...[1, 2, 3, 4, 5].map(value => `check:${value}`),
    'counterexample:0', 'counterexample:1', 'test-audit',
    'complete:counterexamples', 'complete:findings', 'complete:limitations',
  ];
}

function requiredRepair(input) {
  return [
    'header',
    ...input.scope.findings.map(({ id }) => `repaired-finding:${id}`),
    ...input.scope.files.map(value => `regression:${value}`),
    'complete:findings', 'complete:limitations',
  ];
}

function pieceLabel(piece) {
  if (piece.type === 'axis') return piece.axis;
  return pieceKey(piece);
}

export const reviewerEnvelopeText = envelope => `VERDICT: ${envelope.verdict}\nREVIEW: ${JSON.stringify(envelope.report)}`;

export async function createReviewerReportRecorder({
  input, repoRoot, commit, runDirectory, serializedQuoteRepairs = [], submit,
  onAccepted = async () => {}, onProgress = async () => {}, onComplete = async () => {},
}) {
  const repair = input.scope?.kind === 'repair';
  const pendingQuoteRepairs = new WeakMap();
  return createRecordingEngine({
    runDirectory,
    pieceSchema: repair ? repairPieceSchema(input) : initialPieceSchema(input),
    reportSchema: envelopeFor(input),
    keyOf: pieceKey,
    requiredKeys: repair ? requiredRepair(input) : requiredInitial(input),
    checks: [async piece => {
      const repairs = [];
      repairSerializedEvidenceQuotes(piece, input.sources, repairs);
      const problems = [];
      for (const citation of evidenceCitations(piece)) {
        const result = await verifyEvidenceQuote(repoRoot, commit, citation.source, citation.quote, input.sources);
        if (!result.ok) problems.push(`Evidence quote was not found word for word in ${pieceLabel(piece)}: ${citation.quote}`);
      }
      if (!problems.length) pendingQuoteRepairs.set(piece, repairs);
      return problems;
    }],
    assemble: pieces => repair ? assembleRepair(input, pieces) : assembleInitial(input, pieces),
    validate: envelope => {
      try { requireCompleteFileReview(input.files, envelope.report.filesReviewed); }
      catch (error) { return [error.message]; }
      const checked = checkedReview(reviewerEnvelopeText(envelope), input);
      return checked.error && envelope.verdict !== 'INCONCLUSIVE' ? [checked.error] : [];
    },
    submit,
    onAccepted: async (piece, key, acceptedKeys) => {
      serializedQuoteRepairs.push(...pendingQuoteRepairs.get(piece) ?? []);
      pendingQuoteRepairs.delete(piece);
      await onAccepted(piece, key, acceptedKeys);
    },
    onProgress,
    onComplete,
  });
}
