# JUL-242 framework map

| Job | Tool or framework feature | Version-matched documentation |
| --- | --- | --- |
| Give the system service a least-privilege vault identity without putting its token in the environment file | 1Password service accounts and systemd `LoadCredential=` / `$CREDENTIALS_DIRECTORY` | [1Password: Load secrets into scripts](https://developer.1password.com/docs/cli/secrets-scripts) and [systemd.exec credentials](https://www.freedesktop.org/software/systemd/man/255/systemd.exec.html#Credentials) (Ubuntu 24.04 systemd 255) |
| Keep serving the page on the loopback interface | Node `http.createServer()` bound explicitly to `127.0.0.1` | Installed Node v24.14.1 [Node 24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html) |
| Admit a private tailnet request without exposing the page publicly | Tailscale Serve HTTPS reverse proxy, loopback origin, Funnel off, tailnet-only HTTPS certificate | [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve.md) (identity headers; loopback-origin best practice) and [tailscale serve command](https://tailscale.com/docs/reference/tailscale-cli/serve.md) (`--https`/`--http` reverse proxy, `off` to disable) |
| Read every Ready card without a malformed card aborting pagination | Linear GraphQL issue queries and cursor pagination | [Linear GraphQL getting started](https://linear.app/developers/graphql) and [Linear pagination](https://linear.app/developers/pagination) |
| Represent admitted and not-startable cards at the control boundary | Zod discriminated unions, strict objects, `safeParse()`, and structured issues | [Zod schema API](https://zod.dev/api#discriminated-unions) and [Zod error handling](https://zod.dev/basics#handling-errors) |
| Omit routes whose configured ACP executable is absent while preserving genuine discovery failures | Mastra `AcpAgent.getAvailableModels()` and its spawned command boundary | Installed `@mastra/acp` 0.4.2 [`docs/connections/acp`](../../ops/mastra-agents/reviewer/node_modules/@mastra/acp/dist/docs/references/docs-connections-acp.md) and [`AcpAgent` reference](../../ops/mastra-agents/reviewer/node_modules/@mastra/acp/dist/docs/references/reference-acp-acp-agent.md) |
| Drive the card list in a real browser and fail on console errors or uncaught page exceptions | Playwright library `Page` navigation, locators, `console`, and `pageerror` events | Installed Playwright README and [Playwright `Page` API](https://playwright.dev/docs/api/class-page#events) |

The guard change reuses the existing Node HTTP boundary; it adds no new
framework. The server's own tailnet DNS name is configuration
(`JULIA_CONTROL_TAILSCALE_HOST`), supplied by the operator who configures Serve,
rather than inferred by guessing.
