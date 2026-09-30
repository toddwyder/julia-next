import { resolve } from 'node:path';
import { Workspace, LocalFilesystem } from '@mastra/core/workspace';

export const reviewerWorkspace = new Workspace({
  id: 'julia-pr-reviewer-workspace',
  filesystem: new LocalFilesystem({ basePath: resolve(process.cwd(), 'src/mastra/reviewer/workspace') }),
  skills: ['/skills'],
});
