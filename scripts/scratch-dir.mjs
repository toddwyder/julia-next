import { homedir } from 'node:os';
import { join } from 'node:path';

export const scratchDir = join(homedir(), '.local', 'state', 'julia-scratch');
