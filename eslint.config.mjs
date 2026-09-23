import commentsPlugin from '@eslint-community/eslint-plugin-eslint-comments';

export const frameworkRules = {
  'max-lines': ['error', 400],
  'no-restricted-globals': [
    'error',
    {
      name: 'setTimeout',
      message: 'Do not use setTimeout. Use framework waiting or retry mechanisms.',
    },
    {
      name: 'setInterval',
      message: 'Do not use setInterval. Use framework waiting or retry mechanisms.',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: 'WhileStatement[test.type="Literal"]',
      message: 'Do not use while loops with literal conditions. Use framework retry or wait loops.',
    },
    {
      selector: 'DoWhileStatement[test.type="Literal"]',
      message: 'Do not use do...while loops with literal conditions. Use framework retry or wait loops.',
    },
    {
      selector: 'ForStatement[test=null]',
      message: 'Do not use for (;;) loops. Use framework retry or wait loops.',
    },
  ],
  'no-restricted-imports': [
    'error',
    {
      paths: [
        {
          name: 'fs',
          importNames: ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream'],
          message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
        },
        {
          name: 'node:fs',
          importNames: ['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream'],
          message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
        },
        {
          name: 'fs/promises',
          importNames: ['writeFile', 'appendFile'],
          message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
        },
        {
          name: 'node:fs/promises',
          importNames: ['writeFile', 'appendFile'],
          message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
        },
        {
          name: 'node:timers/promises',
          importNames: ['setTimeout', 'setInterval'],
          message: 'Do not use setTimeout or setInterval. Use framework waiting or retry mechanisms.',
        },
        {
          name: 'timers/promises',
          importNames: ['setTimeout', 'setInterval'],
          message: 'Do not use setTimeout or setInterval. Use framework waiting or retry mechanisms.',
        },
        {
          name: 'timers',
          importNames: ['setTimeout', 'setInterval'],
          message: 'Do not use setTimeout or setInterval. Use framework waiting or retry mechanisms.',
        },
        {
          name: 'node:timers',
          importNames: ['setTimeout', 'setInterval'],
          message: 'Do not use setTimeout or setInterval. Use framework waiting or retry mechanisms.',
        },
      ],
    },
  ],
  'no-restricted-properties': [
    'error',
    {
      property: 'writeFile',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      property: 'writeFileSync',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      property: 'appendFile',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      property: 'appendFileSync',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      property: 'createWriteStream',
      message: 'Do not use hand-built progress files or direct file writes. Use framework features.',
    },
    {
      object: 'globalThis',
      property: 'setTimeout',
      message: 'Do not use setTimeout. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'globalThis',
      property: 'setInterval',
      message: 'Do not use setInterval. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'global',
      property: 'setTimeout',
      message: 'Do not use setTimeout. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'global',
      property: 'setInterval',
      message: 'Do not use setInterval. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'window',
      property: 'setTimeout',
      message: 'Do not use setTimeout. Use framework waiting or retry mechanisms.',
    },
    {
      object: 'window',
      property: 'setInterval',
      message: 'Do not use setInterval. Use framework waiting or retry mechanisms.',
    },
  ],
  'eslint-comments/require-description': 'error',
  'eslint-comments/no-unlimited-disable': 'error',
};

export const frameworkPlugins = {
  'eslint-comments': commentsPlugin,
};

export const frameworkConfig = {
  plugins: frameworkPlugins,
  rules: frameworkRules,
  linterOptions: {
    reportUnusedDisableDirectives: 'error',
  },
};

export default [
  {
    ignores: [
      '**',
      '!graph/',
      '!graph/langgraph/**',
    ],
  },
  {
    files: ['graph/langgraph/**'],
    plugins: frameworkPlugins,
    rules: frameworkRules,
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
];
