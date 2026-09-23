// eligibility.mjs -- JUL-98 step 2, items 2 and 3: which card in Ready the
// controller may pick up, and when.
//
// NOTHING here re-implements the eligibility rules. `evaluateEligibility`,
// `sortCardsByBoardOrder`, `openBlockers`, `isBlockerClosed`,
// `ineligibleCommentBody`, `issueFingerprint` and the Decision/Parent label
// constants live in scripts/ready-queue.mjs and are imported. The triage note on
// JUL-98 (2026-09-20) is explicit that refusing a Decision or a Parent card
// already exists and that only the third refusal is new, so a second copy of
// those rules would be a defect: the board would refuse a card in one program
// and admit it in the other.
//
// What IS new:
//   * a card with no section headed exactly `## UAT plan` is refused (Todd's
//     06:16Z readiness review made this a rule of the card it carries, and the
//     12:37Z review confirms JUL-92 now has one);
//   * the walk returns the TOP ELIGIBLE card in board order, skipping the
//     ineligible rather than stalling on them;
//   * the one-full-check rule, kept pure here so the "dropped in and taken out
//     again" case is testable without a state file or a clock.
//
// This module is pure: no Linear call, no Orca call, no disk. The caller posts
// the comment bodies it returns and persists the state maps it returns.

import {
  evaluateEligibility,
  ineligibleCommentBody,
  issueFingerprint,
  sortCardsByBoardOrder,
} from '../../scripts/ready-queue.mjs';
import { parseAcceptanceCriteria, parseUatPlan } from '../../scripts/acceptance-check.mjs';

// The exact heading. Not a phrase to be matched loosely: the whole point of the
// refusal is that a card says, in a section a person can find, how it will be
// checked at the end.
export const UAT_PLAN_HEADING = '## UAT plan';

// `##`, at least one space, the words, nothing else on the line. `###` is a
// different section and does not count; the words in a sentence do not count.
const UAT_PLAN_PATTERN = /^[ \t]*##[ \t]+UAT plan[ \t]*$/m;

export const NO_UAT_PLAN_REASON =
  `the card has no \`${UAT_PLAN_HEADING}\` section; a card the controller carries must say how it will be checked when it reaches UAT`;

// The acceptance check (scripts/acceptance-check.mjs) refuses the step at the
// end unless every acceptance criterion and every UAT-plan item is answered.
// A card with none of either could never pass it, so it is refused before any
// seat is paid for (Todd, 23 Sep).
export const NO_ACCEPTANCE_CRITERIA_REASON =
  'the card lists no acceptance criteria (checkbox lines under an "Acceptance criteria" heading); the acceptance check needs them to accept the work against';
export const NO_UAT_ITEMS_REASON =
  `the card's \`${'## UAT plan'}\` section has no numbered items; the acceptance check needs each item answered before the card reaches UAT`;

export function hasUatPlanSection(description) {
  if (typeof description !== 'string') return false;
  return UAT_PLAN_PATTERN.test(description);
}

// The three refusals in one verdict: the two ready-queue already makes, plus
// the new one. Reasons accumulate, so a card with three faults is refused once
// with three reasons -- one comment, not three.
export function evaluateControllerEligibility(issue, options = {}) {
  const base = evaluateEligibility(issue, options);
  const reasons = [...base.reasons];
  if (!hasUatPlanSection(issue?.description)) reasons.push(NO_UAT_PLAN_REASON);
  else if (!parseUatPlan(issue.description).length) reasons.push(NO_UAT_ITEMS_REASON);
  if (!parseAcceptanceCriteria(issue?.description).length) reasons.push(NO_ACCEPTANCE_CRITERIA_REASON);
  return { eligible: reasons.length === 0, reasons };
}

// Deliberately ready-queue's own body, re-exported under a controller name so
// one card can never get two differently-worded refusals.
export function controllerIneligibleCommentBody(issue, reasons) {
  return ineligibleCommentBody(issue, reasons);
}

// The fingerprint a refusal is deduplicated on. ready-queue's fingerprint
// covers labels, state and blockers; the new refusal turns on the description,
// so whether the card has a plan is part of it. Without that, adding a `## UAT
// plan` section would leave the card silently in its old refusal.
export function controllerFingerprint(issue) {
  return JSON.stringify({
    base: issueFingerprint(issue),
    uatPlan: hasUatPlanSection(issue?.description),
    uatItems: parseUatPlan(issue?.description).length,
    criteria: parseAcceptanceCriteria(issue?.description).length,
  });
}

function fingerprintsOf(issues) {
  const map = {};
  for (const issue of issues ?? []) map[issue.id] = controllerFingerprint(issue);
  return map;
}

// One check's decision, pure.
//
// `previousReady` is what the PREVIOUS check saw in Ready (id -> fingerprint).
// A card that is not in it is a first sighting and cannot start, however
// eligible it is. That is the one-full-check rule, and because `nextReady` is
// rebuilt from the cards that are in Ready NOW, a card that was dropped in and
// taken out again loses its sighting and must earn a fresh one if it returns.
//
// Returns:
//   chosen          the card to start, or null
//   skipped         one entry per card passed over: { issue, status, reasons, comment }
//                   `comment` is the body to post, or null when the card has
//                   already been told about this exact refusal (or when it was
//                   merely a first sighting, which is not a refusal)
//   nextReady       the sightings to persist for the next check
//   nextCommented   the refusal fingerprints to persist for the next check
export function selectStartableCard({
  issues = [],
  previousReady = {},
  previousCommented = {},
  ...eligibilityOptions
} = {}) {
  const ordered = sortCardsByBoardOrder(issues);
  const nextReady = fingerprintsOf(issues);
  // A card that has left Ready keeps no refusal record: if it comes back it is
  // a fresh request and deserves to be told again.
  const nextCommented = {};
  for (const [id, fingerprint] of Object.entries(previousCommented)) {
    if (id in nextReady) nextCommented[id] = fingerprint;
  }

  const skipped = [];
  let chosen = null;

  for (const issue of ordered) {
    if (!(issue.id in previousReady)) {
      // Not a refusal: the card is simply too new to have been seen through a
      // whole check. No comment -- the board would fill up with them.
      skipped.push({ issue: issue.identifier, status: 'first-sighting', reasons: null, comment: null });
      continue;
    }

    const { eligible, reasons } = evaluateControllerEligibility(issue, eligibilityOptions);
    if (eligible) {
      chosen = issue;
      break;
    }

    const fingerprint = controllerFingerprint(issue);
    const alreadyTold = previousCommented[issue.id] === fingerprint;
    nextCommented[issue.id] = fingerprint;
    skipped.push({
      issue: issue.identifier,
      status: 'ineligible',
      reasons,
      comment: alreadyTold ? null : controllerIneligibleCommentBody(issue, reasons),
    });
  }

  if (chosen) {
    // The started card's sighting and any refusal record go: it is leaving
    // Ready, and if it ever returns it earns a full check again.
    delete nextReady[chosen.id];
    delete nextCommented[chosen.id];
  }

  return { chosen, skipped, nextReady, nextCommented };
}
