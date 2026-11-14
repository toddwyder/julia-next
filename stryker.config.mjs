// Mutation testing for the machine's own code. A test earns its place only by catching a
// behavior change, so Stryker breaks the code for real. Node runs each test file in one process
// so the TAP runner can see which mutations it reaches.
export default {
  testRunner: 'tap',
  tap: {
    testFiles: ['machine/**/*.test.mjs', 'machine/*.test.mjs'],
    nodeArgs: ['--test', '--test-isolation=none', '--test-reporter=tap'],
  },
  mutate: ['machine/**/*.mjs', '!machine/**/*.test.mjs', '!machine/guards/fixtures/**'],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: 'reports/mutation/machine.json' },
  thresholds: { high: 100, low: 100, break: null },
  timeoutMS: 120000,
  concurrency: 2,
};
