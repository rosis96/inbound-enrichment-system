# enrich

Internal lead-enrichment system: Happierleads (webhook) → enrichment pipeline → Instantly (API).

## Folder map

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js (App Router) admin UI and webhook endpoints (`/api/hooks/*`) |
| `apps/worker` | Standalone Node service that runs queued pipeline jobs |
| `packages/db` | Database client, schema and migrations |
| `packages/core` | Pipeline rules, ICP scoring, guardrails |
| `packages/providers` | Provider adapters (verifier, finder, people search, crawler, LLM, Instantly) |
| `packages/shared` | Zod schemas, shared types, config |
| `infra` | Deployment files |

## Running

Requires Node 20+ (`nvm use`) and pnpm.

```sh
cp .env.example .env
pnpm install
pnpm dev        # web on http://localhost:3000 + worker
pnpm typecheck
pnpm build
```
