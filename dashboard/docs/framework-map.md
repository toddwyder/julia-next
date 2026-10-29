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

## PR-2 framework map

Read from the installed packages before the PR-2 code, at the versions the build uses: Next
16.3.5 and systemd 255.

| Need | Feature | Official page |
| --- | --- | --- |
| Serve the dashboard from its own entry point, with host and port from the environment | Custom server (programmatic `next()` and `getRequestHandler`) | `dashboard/node_modules/next/dist/docs/01-app/02-guides/custom-server.md` |
| One machine-readable and one human-readable health answer | Route Handlers (`app/api/health/route.js`, `GET`) | `dashboard/node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` |
| A health answer that is never cached | Route Handlers are uncached by default; `dynamic` is removed under Cache Components | `dashboard/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/index.md` and `dashboard/node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md` |
| Run at boot, restart on crash, timers for update and watch | systemd service and timer units | `man systemd.service`, `man systemd.timer`, `man systemd.unit` (systemd 255 on the server) |
| A service that keeps working outside the app process | systemd oneshot units with their own `ExecStart` | `man systemd.service` (§`Type=oneshot`) |

The custom server exists because the unit has to start the app with a host and port that come from
the env file, and the app has to answer before systemd considers the start finished. `next start`
can do the first but not the second, so `server.js` uses the documented programmatic entry point.

## Isolated build root

The first build discovered the ancestor configuration and bundled Julia instrumentation. The coordinator authorized `dashboard/next.config.mjs` to set `turbopack.root` to the dashboard folder. The production build now uses Next 16.3.5 without Julia instrumentation files or Sentry imports. The production startup log contains only the dashboard startup lines.
