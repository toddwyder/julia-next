// github-intake-rules.mjs -- issue #180: Factory GitHub intake rules.
// Excludes machine-generated issues (labeled factory:machine) from entering Factory's Intake board.

export const MACHINE_ISSUES = new Set([1, 136, 137, 138, 139, 140, 144, 146, 148, 151, 152, 154, 156, 158]);

export function isMachineIssue(issue) {
  if (!issue) return false;
  if (typeof issue.number === 'number' && MACHINE_ISSUES.has(issue.number)) return true;
  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((l) => (typeof l === 'string' ? l : l.name))
    : [];
  return labels.includes('factory:machine');
}

export function filterIssueForIntake(context, defaultRule) {
  if (context?.issue && isMachineIssue(context.issue)) {
    return undefined;
  }
  return typeof defaultRule === 'function' ? defaultRule(context) : { type: 'upsertLinkedWorkItem', stage: 'intake' };
}
