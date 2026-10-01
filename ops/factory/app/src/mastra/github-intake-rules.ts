// github-intake-rules.ts -- issue #180: Factory GitHub intake rules.
// Excludes machine-generated issues (labeled factory:machine) from entering Factory's Intake board.

export const MACHINE_ISSUES = new Set([1, 136, 137, 138, 139, 140, 144, 146, 148, 151, 152, 154, 156, 158]);
export const MACHINE_PULL_REQUESTS = new Set([131, 134, 135, 141, 142, 143, 145, 147, 149, 150, 153, 155, 157, 159]);

export function isMachineIssue(issue: { number?: number; labels?: Array<string | { name: string }> } | null | undefined): boolean {
  if (!issue) return false;
  if (typeof issue.number === 'number' && MACHINE_ISSUES.has(issue.number)) return true;
  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((l) => (typeof l === 'string' ? l : l?.name)).filter(Boolean)
    : [];
  return labels.includes('factory:machine');
}

export function filterIssueForIntake<T>(context: { issue?: any }, defaultRule?: (ctx: any) => T): T | undefined {
  if (context?.issue && isMachineIssue(context.issue)) {
    return undefined;
  }
  return typeof defaultRule === 'function' ? defaultRule(context) : ({ type: 'upsertLinkedWorkItem', stage: 'intake' } as any);
}
