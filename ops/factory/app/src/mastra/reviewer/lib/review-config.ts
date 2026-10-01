/**
 * Shared review configuration — file skip patterns and review depth thresholds.
 */

export const SKIP_PATTERNS = [
  /\.lock$/,
  /\.lockb$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /node_modules\//,
  /dist\//,
  /build\//,
  /\.min\.(js|css)$/,
  /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|webm|mp3)$/,
  /\.map$/,
  /\.generated\./,
  /__snapshots__\//,
];

export const SMALL_PR_MAX = 6;
export const MEDIUM_PR_MAX = 20;

export function getReviewDepth(fileCount: number): string {
  if (fileCount <= SMALL_PR_MAX) {
    return 'DETAILED — perform a thorough line-by-line review of every change.';
  }
  if (fileCount <= MEDIUM_PR_MAX) {
    return 'FOCUSED — focus on logic correctness and architectural decisions. Call out key issues but skip minor style nits.';
  }
  return 'HIGH-LEVEL — focus only on critical issues: bugs, security vulnerabilities, and major design concerns.';
}

export const REVIEW_DEPTH_INSTRUCTIONS = `- **Small PRs (1–${SMALL_PR_MAX} files):** Perform a detailed line-by-line review. Examine every change closely, comment on style, logic, naming, and edge cases.
- **Medium PRs (${SMALL_PR_MAX + 1}–${MEDIUM_PR_MAX} files):** Focus on logic correctness and architectural decisions. Call out key issues but don't nitpick every line.
- **Large PRs (${MEDIUM_PR_MAX + 1}+ files):** Provide a high-level architecture review. Focus only on critical issues — bugs, security vulnerabilities, and major design concerns.`;

export const MIN_DELETION_ONLY_LINES = 50;

export const REVIEWER_CHECKS = [
  'unit tests',
  'integration tests at affected boundaries',
  'end-to-end for the changed journey',
  'a clean browser console',
  'logging good enough to find a root cause',
] as const;

export const REVIEWER_CHECKS_INSTRUCTIONS = `Record evidence tied to the change for each check, or explain why it does not apply; missing evidence is a finding.

1. **unit tests** — meaningful behavior/regression coverage through appropriate interfaces.
2. **integration tests at affected boundaries** — exercise the changed component/storage/service/provider contract across the boundary.
3. **end-to-end for the changed journey** — the affected user journey through the assembled test app with test data, including failure paths.
4. **a clean browser console** — no unexpected console errors/unhandled failures (no browser surface: mark not applicable).
5. **logging good enough to find a root cause** — lasting logs/measurements identify the failing operation and context without exposing secrets.`;
