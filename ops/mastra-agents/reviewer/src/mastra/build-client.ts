import { z } from 'zod/v4';
import {
  RunSnapshotSchema,
  ReadyCardSchema,
  InitializationRolesSchema,
  InitializationResultSchema,
} from './contracts.ts';

export const BuildResultSchema = z
  .object({
    state: z.literal('ready-for-review'),
    card: ReadyCardSchema,
    roles: InitializationRolesSchema,
    actualModels: z.object({
      orchestrator: z.string().min(1),
      coder: z.string().min(1),
    }),
    threadId: z.string().min(1),
    worktree: z.string().min(1),
    baseCommit: z.string().min(1),
    candidateCommit: z.string().min(1),
    account: z
      .object({
        spentNano: z.number().nonnegative(),
        heldNano: z.number().nonnegative(),
        stopped: z.boolean(),
      })
      .passthrough(),
    internalReview: z.record(z.string(), z.unknown()),
    downstreamReviewStarted: z.boolean(),
    completedAt: z.string().datetime(),
  })
  .passthrough();

export const BuildChecklistItemSchema = z
  .object({
    text: z.string().min(1),
    status: z.enum(['finished', 'skipped', 'pending']),
    depth: z.number().int().nonnegative().optional(),
  })
  .strict();

export const BuildChecklistSummarySchema = z
  .object({
    finished: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
  })
  .strict();

export const BuildChecklistSchema = z
  .object({
    items: z.array(BuildChecklistItemSchema),
    summary: BuildChecklistSummarySchema,
    updatedAt: z.string().datetime().nullable().optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    const counts = { finished: 0, skipped: 0, pending: 0 };
    for (const item of value.items) counts[item.status] += 1;
    if (counts.finished !== value.summary.finished || counts.skipped !== value.summary.skipped || counts.pending !== value.summary.pending) {
      context.addIssue({ code: 'custom', message: 'checklist summary must match its items' });
    }
  });

export const BuildJobSchema = z
  .object({
    runId: z.string().min(1),
    snapshot: RunSnapshotSchema,
    settingsPath: z.string().nullable().optional(),
    worktree: z.string().min(1),
    baseCommit: z.string().min(1),
    state: z.enum(['running', 'ready-for-review', 'failed', 'paused']),
    runnerPid: z.number().int().positive(),
    workerPid: z.number().int().positive().nullable(),
    result: BuildResultSchema.nullable(),
    error: z.object({ message: z.string() }).passthrough().nullable(),
    checklist: BuildChecklistSchema.optional(),
    createdAt: z.string().datetime().optional(),
  })
  .passthrough()
  .refine((job) => job.state !== 'ready-for-review' || job.result !== null, {
    message: 'ready-for-review build requires result',
  })
  .refine((job) => job.state !== 'failed' || job.error !== null, {
    message: 'failed build requires error',
  })
  .refine((job) => job.state !== 'paused' || job.error !== null, {
    message: 'paused build requires its pause reason',
  });

export const BuildStartResultSchema = InitializationResultSchema.extend({
  build: BuildJobSchema.optional(),
});

export type BuildJob = z.infer<typeof BuildJobSchema>;
export type BuildStartResult = z.infer<typeof BuildStartResultSchema>;

export function createBuildRunnerClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error('Invalid build runner URL');
  }
  if (parsedUrl.protocol !== 'http:') {
    throw new Error('Build runner URL must use http');
  }

  async function rejectIfNotOk(response: Response): Promise<void> {
    if (response.ok) return;
    const body = await response.text().catch(() => '');
    throw new Error(
      `Build runner request failed: ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`,
    );
  }

  return {
    async start(saved: z.infer<typeof InitializationResultSchema>): Promise<BuildJob> {
      const response = await fetchImpl(`${baseUrl}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(saved),
        signal: AbortSignal.timeout(15000),
      });
      await rejectIfNotOk(response);
      return BuildJobSchema.parse(await response.json());
    },
    async list(): Promise<unknown[]> {
      const response = await fetchImpl(`${baseUrl}/jobs`, {
        signal: AbortSignal.timeout(15000),
      });
      await rejectIfNotOk(response);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error('Build runner jobs must be an array');
      return body;
    },
  };
}
