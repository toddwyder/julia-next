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
