export const DEFAULT_REVIEWER = Object.freeze({
  provider: 'commandcode',
  model: 'deepseek/deepseek-v4.1-flash',
  connection: 'existing-commandcode',
});

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

export function requestWithoutOutputCap(body) {
  const request = { ...body };
  delete request.max_tokens;
  delete request.max_completion_tokens;
  delete request.max_output_tokens;
  return request;
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
