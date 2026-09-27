import type { InstalledBoard } from '@mastra/factory/boards';
export function createTrialBoard(options: { evidenceDir: string }): InstalledBoard;
export function checkEvidence(evidenceDir: string, candidate: string, stage: string): Promise<string[]>;
export const requiredEvidence: Record<string, string[]>;
