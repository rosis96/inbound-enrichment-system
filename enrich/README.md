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

## Running locally

Requires Node 20.12+ (`nvm use`), pnpm and Postgres 13+.

```sh
cp .env.example .env
# fill in DATABASE_URL and ENCRYPTION_KEY (openssl rand -base64 32)
docker compose -f infra/docker/docker-compose.yml up -d   # optional local Postgres
pnpm install
pnpm db:migrate
pnpm db:seed      # demo client (dry run) + prompt v1; prints its webhook URLs
pnpm dev          # web on http://localhost:3000 + worker
```

All apps and scripts read the single root `.env`; env is validated at startup (`packages/shared/src/env.ts`).

| Script | What it does |
| --- | --- |
| `pnpm db:generate` | Generate a migration from schema changes (`packages/db/src/schema`) |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:seed` | Idempotent demo data |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | Across all workspaces |

## Assumptions

Assumptions to verify are marked `// ASSUMPTION:` in code and listed here.

- `ClientSettings.ownDomains` was added (not in the original spec) so the "domain equals the client's own domain" gate has data.
- `prompts.model` is nullable; null means "use `OPENAI_MODEL`".
