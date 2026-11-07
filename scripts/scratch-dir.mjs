import { homedir } from 'node:os';
import { join } from 'node:path';

export const scratchDir = process.env.JULIA_SCRATCH_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'julia-scratch');
