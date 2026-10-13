# enrich

Internal lead-enrichment system: Happierleads (webhook) → enrichment pipeline → Instantly (API).

## Current flow

```
POST /api/hooks/happierleads/:clientToken → raw_events → lead.normalise → lead.gates → lead.icp → lead.research → lead.personalise → lead.push
```

| Step | Does | Ends as |
| --- | --- | --- |
| webhook | Constant-time token check against every client, stores the raw payload, enqueues `lead.normalise` | 404 unknown token, 400 non-JSON |
| normalise | Tolerant parse (`packages/core/src/happierleads.ts`), upserts the company by domain, creates the lead and its contacts | `raw_events.error` when there is no usable domain |
| gates | Own domain, free-email domain, suppressed domain, dedupe (same company `pushed`/`dry_run_complete` within `dedupeDays`); drops suppressed, free-email and email-less contacts | `gated_out` |
| icp | 0–100 score, 20 points each for country, size, industry, title and high-intent pages, with a reason per factor; picks the best contact | `below_icp` (default `icp.minScore` is 80) |
| research | Crawls the company website (homepage plus up to 3 same-site about/services/product/customer pages; Firecrawl fallback when the homepage has under 400 characters of text and `FIRECRAWL_API_KEY` is set; private and internal addresses are refused), keeps up to 12,000 characters in `companies.crawl_text`, then summarises it with the active `company_summary` prompt into `companies.summary`. Shared across clients and reused for 30 days. Never blocks the lead: failures are recorded and the lead moves on | `researched` data on the company; the lead goes to personalise either way |
| personalise | Writes the client's AI variables (`aiVariables` in settings, default `subject_line` and `personalized_first_line`) in one OpenAI JSON-mode request with `OPENAI_MODEL`, two candidates each; keeps the first candidate that passes its word/character limits, banned phrases, no brackets and no mention of the visit. Stored in `contacts.ai_variables`. Skipped when `copy.aiVariablesEnabled` is off or OpenAI is not configured | `personalised`; missing variables are left out and the lead still goes to push, unless `copy.requireAiVariables` is on (then `failed`) |
| push | `POST https://api.instantly.ai/api/v2/leads` with `skip_if_in_workspace: true` and string-only `custom_variables` (lead built-ins, the AI variables, and the client's custom variables rendered with `{{name|fallback}}`). In dry run (`GLOBAL_DRY_RUN` or the client's switch) the request is saved instead of sent | `dry_run_complete`, `pushed`, `no_contact` or `failed` (401, 402, other 4xx, no campaign, no API key; 429, 5xx and network errors are retried 3 times first) |

Jobs live in the `jobs` table (`packages/db/src/queue.ts`): workers claim them with an atomic
`UPDATE … ORDER BY … LIMIT 1`, retry with exponential backoff (3 retries, 5 s doubling up to 300 s), requeue jobs left
active by a crashed worker after 15 minutes and delete finished jobs after 7 days.
Every step writes a row to `enrichment_steps`; the lead page shows them, including the Instantly request and response.
The `people`, `email` and `review` jobs are still stubs and are not in the chain. The writer uses the website summary when there is one, otherwise an excerpt of the crawled text, otherwise just name and industry.

Admin UI at http://localhost:3000, login with `ADMIN_EMAIL` / `ADMIN_PASSWORD`:

- **Leads**: table, and a page per lead with ICP reasons, contacts, raw payload, Instantly request/response and a
  **Reprocess** button (re-runs the chain from the stored payload with the current settings)
- **Clients**: webhook URLs
- **Dashboard**: lead counts, leads per day, status breakdown, worker/queue health, AI spend, per-client totals
- **Settings**: ICP lists, threshold, high-intent pages, campaign ID, dry run, Instantly API key (stored encrypted), email copy
  (sender, offer, tone, banned phrases), AI variables (name, instructions, word/character limits, examples) and custom
  variables (`name = value` per line)
- **Sequence**: the email steps (wait days, A–E versions per step) with starter templates, click-to-insert variables,
  checks (unknown variables, missing subject, leftover `[placeholders]`, banned phrases) and a preview rendered for a real
  lead. **Create campaign in Instantly** makes a paused campaign (`POST /api/v2/campaigns`: schedule, steps, sending
  accounts, daily limit, stop on reply) and links it as the client's campaign; once linked, **Push sequence** replaces its
  sequence and schedule (`PATCH /api/v2/campaigns/:id`). Bodies are sent as simple HTML (`<div>` per line); our "wait N
  days before this step" becomes Instantly's `delay` on the previous step. Launching the campaign stays manual in Instantly.

## Folder map

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js (App Router) admin UI and webhook endpoints (`/api/hooks/*`) |
| `apps/worker` | Standalone Node service that runs queued pipeline jobs |
| `packages/db` | MySQL client (Drizzle + mysql2), schema, migrations and the job queue |
| `packages/core` | Pipeline rules: payload parsing, gates, ICP scoring, Instantly request |
| `packages/providers` | Provider adapters (verifier, finder, people search, crawler, LLM, Instantly) |
| `packages/shared` | Zod schemas, shared types, config |
| `scripts/samples` | Sample Happierleads payloads |
| `infra` | Deployment files |

## Running locally

Requires Node 20.12+ (`nvm use`), pnpm and MySQL 8+ or MariaDB 10.4+ (XAMPP's MariaDB works).

```sh
cp .env.example .env
# fill in DATABASE_URL, ENCRYPTION_KEY and SESSION_SECRET (openssl rand -base64 32), ADMIN_EMAIL and ADMIN_PASSWORD
# create the database: CREATE DATABASE enrich CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
docker compose -f infra/docker/docker-compose.yml up -d   # optional local MySQL instead
pnpm install
pnpm db:migrate
pnpm db:seed      # demo client (dry run), prompt v1 and the superadmin; prints the webhook URLs
pnpm dev          # web on http://localhost:3000 + worker

pnpm sample:happierleads          # high-fit sample → dry_run_complete (ICP 100)
pnpm sample:happierleads low      # low-fit sample → below_icp
pnpm sample:happierleads --fresh  # random company domain, so a repeat is not caught by the dedupe gate
```

All apps and scripts read the single root `.env`; env is validated at startup (`packages/shared/src/env.ts`).

| Script | What it does |
| --- | --- |
| `pnpm db:generate` | Generate a migration from schema changes (`packages/db/src/schema`) |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm db:seed` | Idempotent demo data and superadmin (re-run to change the admin password) |
| `pnpm sample:happierleads` | POST a sample payload to the local webhook: `high` (default), `low` or a JSON file path; `--fresh`, `--client <slug>` |
| `pnpm typecheck` / `pnpm test` / `pnpm build` | Across all workspaces |

## Assumptions

Assumptions to verify are marked `// ASSUMPTION:` in code and listed here.

- `ClientSettings.ownDomains` was added (not in the original spec) so the "domain equals the client's own domain" gate has data.
- `prompts.model` is nullable; null means "use `OPENAI_MODEL`".
- Happierleads payload field names are guesses (`packages/core/src/happierleads.ts`); every lookup tries several
  spellings and only the company domain is required. Check against a real webhook and adjust.
- The Instantly create-lead response is assumed to carry the new lead's `id` (`packages/providers/src/instantly`).
- Dedupe counts an earlier lead for the same company only once it reached `pushed` or `dry_run_complete`.
- An excluded industry forces the ICP score to 0. A seniority match without a title keyword earns half the title points.
- Timestamps are DATETIME(3) in UTC, set by the app (not `NOW()`), so the database server's time zone does not matter.
- JSON columns use a custom type that parses strings, because MariaDB stores JSON as LONGTEXT.
- One campaign ID per client in the UI (`campaigns.default`); per-intent campaigns exist in the settings schema but have no UI yet.
