# PR-1 framework map

Read from installed Next 16.3.5 before app code. The package includes these pages under `node_modules/next/dist/docs/`.

| Need | Feature | Official page |
| --- | --- | --- |
| Separate server-rendered pages and layout | App Router | https://nextjs.org/docs/app/getting-started/layouts-and-pages |
| Fresh server reads per request | connection and fetch no-store | https://nextjs.org/docs/app/api-reference/functions/connection and https://nextjs.org/docs/app/api-reference/functions/fetch |
| Card id in the URL | Async params | https://nextjs.org/docs/app/api-reference/file-conventions/page |
| Loading during real reads | Suspense and loading.jsx | https://nextjs.org/docs/app/api-reference/file-conventions/loading |
| Public Sans without browser font requests | next/font/google | https://nextjs.org/docs/app/api-reference/components/font |
| App isolation | Turbopack root | https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory |
| Named role assertions and screenshots | Playwright Test | https://playwright.dev/docs/test-assertions and https://playwright.dev/docs/test-use-options |
| GraphQL connections | Linear pagination | https://linear.app/developers/pagination |
| Node boundary tests | node:test | https://nodejs.org/api/test.html |

## Isolated build root

The first build discovered the ancestor configuration and bundled Julia instrumentation. The coordinator authorized `dashboard/next.config.mjs` to set `turbopack.root` to the dashboard folder. The production build now uses Next 16.3.5 without Julia instrumentation files or Sentry imports. The production startup log contains only the dashboard startup lines.
