// Names, model and schemas for the card path. Every stage shares one data
// schema so a branch, a loop body and a nested workflow can hand their result
// to the next stage without a translation step.

import { z } from 'zod';

export const CARD_PATH = 'card-path';
export const ATTEMPT = 'attempt';
export const REVIEW_ROUND = 'review-round';
export const SMOKE_LOOP = 'smoke-loop';
export const SMOKE_ROUND = 'smoke-round';
export const FIX_AND_LAND = 'fix-and-land';

export const FREE_MODEL = 'commandcode/reflection/beam:free';

export const flowData = z
  .object({
    card: z.string(),
    kind: z.enum(['product', 'machine']),
    detail: z.string().default(''),
    verdict: z.enum(['PASS', 'FAIL']).nullable().default(null),
    smoke: z.enum(['PASS', 'FAIL']).nullable().default(null),
    failCount: z.number().int().min(0).default(0),
    accepted: z.boolean().default(false),
    rejected: z.boolean().default(false),
    landed: z.boolean().default(false),
    stopped: z.boolean().default(false),
    finished: z.boolean().default(false),
  })
  .passthrough();

export const cardState = z.object({
  card: z.string(),
  kind: z.enum(['product', 'machine']),
  failCount: z.number().int().min(0).default(0),
  reviewRound: z.number().int().min(0).default(0),
  buildRounds: z.number().int().min(0).default(0),
  requestId: z.string().default(''),
  request: z.string().default(''),
  answer: z.string().default(''),
  stopPart: z.string().default(''),
  stopWhy: z.string().default(''),
});

export const initialState = (card, kind) => ({
  card,
  kind,
  failCount: 0,
  reviewRound: 0,
  buildRounds: 0,
  requestId: '',
  request: '',
  answer: '',
  stopPart: '',
  stopWhy: '',
});
