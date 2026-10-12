export const DEFAULT_REVIEWER = Object.freeze({
  provider: 'commandcode',
  model: 'deepseek/deepseek-v4.1-flash',
  connection: 'existing-commandcode',
});
export const REVIEW_MAX_OUTPUT_TOKENS = 4096;
export const REVIEW_TOTAL_MS = 20 * 60 * 1000;
export const REVIEW_STEP_MS = 15 * 1000;

export function reviewerConfiguration(configuration = {}) {
  const reviewer = configuration.reviewer ?? configuration;
  const savedConnection = reviewer.connection;
  const resolved = {
    ...DEFAULT_REVIEWER,
    model: reviewer.model ?? DEFAULT_REVIEWER.model,
    connection: savedConnection?.provider === 'commandcode' ? 'existing-commandcode' : savedConnection?.route ?? savedConnection ?? DEFAULT_REVIEWER.connection,
  };
  return resolved;
}

export function reviewPromptContract(input) {
  return {
    ...input,
    sources: Object.fromEntries(Object.entries(input.sources ?? {}).filter(([source]) => source !== 'diff' && !source.startsWith('file:'))),
    recording: {
      mode: 'small-tools',
      record: 'record_piece', replace: 'replace_piece', remove: 'remove_piece', missing: 'show_missing', submit: 'submit_report',
    },
  };
}

export function reviewStepBudget(changedFiles, criteria) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) throw new Error('reviewer needs at least one changed file');
  if (!Array.isArray(criteria) || criteria.length === 0) throw new Error('reviewer needs at least one acceptance criterion');
  // Reading/analysis: inventory, diff, every file and criterion, and quote review.
  // Recording: header, two axes, every file and criterion, five checks, two
  // counterexamples, test audit, three collection markers, and submit. Give
  // every recording call one correction call, then allow a final acknowledgement.
  // Findings and limitations are independent parallel calls, not count-capped.
  return (changedFiles.length + criteria.length + 3)
    + (changedFiles.length + criteria.length + 15) * 2
    + 1;
}

export function reviewGenerationOptions(changedFiles, criteria) {
  return {
    maxSteps: reviewStepBudget(changedFiles, criteria),
    modelSettings: {
      maxRetries: 0,
      maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
      timeout: { totalMs: REVIEW_TOTAL_MS, stepMs: REVIEW_STEP_MS },
    },
  };
}

export function requireCompleteFileReview(changedFiles, reviewedFiles) {
  const changed = [...changedFiles].sort();
  const reviewed = [...reviewedFiles].sort();
  const duplicate = reviewed.find((file, index) => file === reviewed[index - 1]);
  if (duplicate) throw new Error(`reviewer refused: duplicate ${duplicate}`);
  const missing = changed.find(file => !reviewed.includes(file));
  if (missing) throw new Error(`reviewer refused: missing ${missing}`);
  const unexpected = reviewed.find(file => !changed.includes(file));
  if (unexpected) throw new Error(`reviewer refused: unexpected ${unexpected}`);
  return reviewed;
}
