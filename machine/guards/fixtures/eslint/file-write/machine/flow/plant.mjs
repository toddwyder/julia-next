import { writeFileSync } from 'node:fs';

export const save = (path, text) => writeFileSync(path, text);
