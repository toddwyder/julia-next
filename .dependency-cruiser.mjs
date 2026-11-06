// Guards the machine workflow folder's place in the repo: it reaches no stage it replaced,
// it imports only the packages the card allows, and every piece in it is reachable from its entry.
// Run it with `npm run guard:flow`, which names the folder and the entry together.

const FLOW = '^machine/flow/';
const ENTRY = '^machine/flow/run\\.mjs$';

const allowedPackages = [
  '@mastra/core',
  '@mastra/duckdb',
  '@mastra/libsql',
  '@mastra/observability',
  '@duckdb/node-api',
  'zod',
];

const anyPackage = `(?:${allowedPackages.join('|')})`;
const subscriptionProviderPattern = '^(?:@mastra/code-sdk/providers/(?:openai-codex|claude-max))$|(?:^|/)node_modules/@mastra/code-sdk/dist/providers/(?:openai-codex|claude-max)\\.(?:js|cjs)$';
const allowedPackagePattern = `^(?:${anyPackage})(?:$|/)|(?:^|/)node_modules/(?:${anyPackage})(?:$|/)|${subscriptionProviderPattern}`;
const outsidePackagePattern = '^(?:@|[a-zA-Z])|/node_modules/';

export default {
  forbidden: [
    {
      name: 'flow-reaches-no-old-stage',
      severity: 'error',
      comment:
        'The workflow folder carries a card through every stage, so it may not import a stage folder it replaced.',
      from: { path: FLOW },
      to: { path: '^machine/(shipping|merge|remediation)/' },
    },
    {
      name: 'flow-imports-only-allowed-packages',
      severity: 'error',
      comment: `The workflow folder imports only these packages: ${allowedPackages.join(', ')}.`,
      from: { path: FLOW },
      to: {
        dependencyTypesNot: ['core', 'local'],
        path: outsidePackagePattern,
        pathNot: allowedPackagePattern,
      },
    },
    {
      name: 'flow-denies-mastra-code-sdk',
      severity: 'error',
      comment: 'The workflow folder uses only Mastra Code subscription providers, not its coding agent.',
      from: { path: FLOW },
      to: {
        dependencyTypesNot: ['core', 'local'],
        path: '^(?:@mastra/code-sdk)(?:$|/)|(?:^|/)node_modules/@mastra/code-sdk(?:$|/)',
        pathNot: subscriptionProviderPattern,
      },
    },
    {
      name: 'flow-piece-reachable-from-entry',
      severity: 'error',
      comment:
        'Every file in the workflow folder is reachable from the entry, so no stage or rule sits outside the card path.',
      from: { path: ENTRY },
      to: {
        path: FLOW,
        pathNot: '\\.test\\.mjs$',
        reachable: false,
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    combinedDependencies: true,
  },
};
