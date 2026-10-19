# Pre-plan framework map

| Job | Tool or framework feature | Version-matched documentation |
| --- | --- | --- |
| Run the small TypeScript admission command without a build step | Node.js 24 built-in TypeScript type stripping | [Node.js 24: Modules — TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html#type-stripping) |
| Read a Linear card with the restricted Julia credential and reject HTTP or GraphQL failures | Existing `fetchLinearIssue` adapter over Linear's GraphQL endpoint and personal-key authentication | [Linear GraphQL API: Getting started](https://linear.app/developers/graphql) |
| Apply the launcher's admission contract and return its structured findings | Existing `CardAdmissionSchema.safeParse()` with Zod 4.6.5 | [Zod: Basic usage and error handling](https://zod.dev/basics#handling-errors) |
| Resolve only the Linear secret for the command | Existing Windows Julia vault wrapper | `scripts/julia-vault-windows.ps1` and `docs/agents/julia-secret-vault.md` |

The command adds no admission rules. `ops/mastra-agents/reviewer/src/mastra/contracts.ts` remains
the single definition used by both the launcher and pre-plan admission.
