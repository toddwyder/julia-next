// Names, model and schemas for the card path. Every stage shares one data
// schema so a branch, a loop body and a nested workflow can hand their result
// to the next stage without a translation step.

import { z } from 'zod';

export const CARD_PATH = 'card-path';
export const ATTEMPT = 'attempt';
export const BUILD_ROUND = 'build-round';
export const REVIEW_PHASE = 'review-phase';
export const REVIEW_ROUND = 'review-round';
export const SMOKE_LOOP = 'smoke-loop';
export const SMOKE_ROUND = 'smoke-round';
export const FIX_AND_LAND = 'fix-and-land';

// What a run is asked for when it is started. This is the whole form a person
// fills in: which card, and whether it is a product card or a machine card.
export const runInput = z.object({
  card: z.string().min(1),
  kind: z.enum(['product', 'machine']),
});

export const flowData = z
  .object({
    card: z.string(),
    kind: z.enum(['product', 'machine']),
    prompt: z.string().default(''),
    detail: z.string().default(''),
    verdict: z.enum(['PASS', 'PASS+NOTES', 'FAIL']).nullable().default(null),
    unreviewed: z.boolean().default(false),
    pr: z.number().int().nullable().default(null),
    sha: z.string().default(''),
    answer: z.string().default(''),
    criteriaCount: z.number().default(0),
    smoke: z.enum(['PASS', 'FAIL']).nullable().default(null),
    failCount: z.number().int().min(0).default(0),
    accepted: z.boolean().default(false),
    rejected: z.boolean().default(false),
    landed: z.boolean().default(false),
    stopped: z.boolean().default(false),
    finished: z.boolean().default(false),
    checkPassed: z.boolean().default(false),
    checkReason: z.string().default(''),
  })
  .passthrough();

// Every field carries a default, so a run started with no saved state at all
// still has valid state: the run form only asks for the card and its kind.
export const cardState = z.object({
  card: z.string().default(''),
  kind: z.enum(['product', 'machine']).default('product'),
  failCount: z.number().int().min(0).default(0),
  reviewRound: z.number().int().min(0).default(0),
  buildRounds: z.number().int().min(0).default(0),
  copy: z.string().default(''),
  base: z.string().default(''),
  requestId: z.string().default(''),
  request: z.string().default(''),
  answer: z.string().default(''),
  stopPart: z.string().default(''),
  stopWhy: z.string().default(''),
  unreviewed: z.boolean().default(false),
  checkReturns: z.number().int().min(0).default(0),
  checkReasons: z.array(z.string()).default([]),
});
