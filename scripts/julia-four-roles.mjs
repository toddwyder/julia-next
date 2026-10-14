// Rule validation for four delivery roles per ADR 0021 and Todd (14 Oct 2026).
export const FOUR_DELIVERY_ROLES = Object.freeze([
  'builder',
  'reviewer',
  'crashFixer',
  'fixReviewer',
]);

export function normalizeRoleName(role) {
  if (role === 'recoveryReviewer' || role === 'fix-reviewer') return 'fixReviewer';
  if (role === 'crash-fixer') return 'crashFixer';
  return role;
}

export function validateRoleMakersAndServices({
  builder,
  reviewer,
  crashFixer,
  fixReviewer,
  allowSameService = false,
}) {
  if (!builder || !reviewer) {
    throw new Error('validateRoleMakersAndServices: builder and reviewer roles are required');
  }

  const builderMaker = (builder.maker || '').trim().toLowerCase();
  const reviewerMaker = (reviewer.maker || '').trim().toLowerCase();

  // Rule: Builder and reviewer are ALWAYS from different companies.
  // An explicit per-run override allows them to share a service; it NEVER allows the same company.
  if (builderMaker && reviewerMaker && builderMaker === reviewerMaker) {
    throw new Error(
      `builder and reviewer must be from different companies; got "${builder.maker}" for both`
    );
  }

  // Service check between builder and reviewer
  const builderService = (builder.service || '').trim().toLowerCase();
  const reviewerService = (reviewer.service || '').trim().toLowerCase();
  if (!allowSameService && builderService && reviewerService && builderService === reviewerService) {
    throw new Error(
      `builder and reviewer share service "${builder.service}"; different services are required unless --allow-same-service is specified`
    );
  }

  // Rule: Crash-fixer and fix reviewer must be from different companies.
  if (crashFixer && fixReviewer) {
    const crashFixerMaker = (crashFixer.maker || '').trim().toLowerCase();
    const fixReviewerMaker = (fixReviewer.maker || '').trim().toLowerCase();
    if (crashFixerMaker && fixReviewerMaker && crashFixerMaker === fixReviewerMaker) {
      throw new Error(
        `crash-fixer and fix-reviewer must be from different companies; got "${crashFixer.maker}" for both`
      );
    }
  }
}
