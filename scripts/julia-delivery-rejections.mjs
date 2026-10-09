import { sha256 } from './julia-delivery-state.mjs';

export function reviewProblems(findings) {
  return findings.map(finding => ({
    problemId: finding.problemId?.trim() || sha256(JSON.stringify([finding.file, finding.requirement, finding.mechanism].map(value => value.trim().toLowerCase().replace(/\s+/g, ' ')))),
    file: finding.file, requirement: finding.requirement, mechanism: finding.mechanism,
  }));
}

// Reconstruct from saved evidence rather than incrementing a volatile counter.
// Legacy reports remain classifiable by their requirement/file/mechanism.
export function rejectionHistory(reports) {
  const rejections = new Map();
  for (const report of reports) {
    const problems = report.problems ?? reviewProblems(JSON.parse(report.text.split('REVIEW: ')[1]).findings);
    for (const id of new Set(problems.map(problem => problem.problemId))) {
      const rejection = rejections.get(id) ?? { problemId: id, reports: [] };
      rejection.reports.push({ round: report.round, commit: report.commit, handoffPath: report.handoffPath, text: report.text }); rejections.set(id, rejection);
    }
  }
  return [...rejections.values()];
}
