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
| personalise | Writes the client's AI variables (`aiVariables` in settings) with `packages/core/src/variables.ts`: one planner call builds a research plan from the crawled website (category, industry, specific details with quotes and source pages, relevant client services, possible challenges, benefits, unknowns), then the variables are written in dependency order, one call per layer, validated and corrected up to twice with the same research. Stored in `contacts.ai_variables`; the plan, checks and attempts are on the step. Skipped when `copy.aiVariablesEnabled` is off or OpenAI is not configured | `personalised`; variables that never pass are left out and the lead still goes to push, unless `copy.requireAiVariables` is on (then `failed`) |
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
  (sender, offer, tone, banned phrases, the services the client delivers and the proof it may cite), AI variables (name,
  instructions, word/character limits, exact sentences, required opening, "written after" dependencies, examples) and
  custom variables (`name = value` per line)
- **Suppression**: per-client do-not-contact domains and emails (customer, open deal, competitor, meeting booked, form
  submitted, …), added by pasting, CSV or the blocklist webhook, with optional expiry; checked by the gates step and again
  just before push. Adding an entry moves the client's already-sent leads it matches to `suppressed`. The worker copies
  active entries to the client's Instantly blocklist every minute (`POST /api/v2/block-lists-entries/bulk-create`), which
  stops leads already in a campaign, and deletes the copy when an entry expires or is removed. Nothing is sent to
  Instantly in dry run (global or the client's) or without the client's API key; the page shows each entry's sync state.
- **Blocklist webhook** `POST /api/hooks/blocklist/:blocklistToken` (URL on Clients and Suppression): for the client's
  form and booking tools, directly or through Zapier/Make. The tool is not known in advance, so the body (JSON, urlencoded
  or multipart) is searched for the shallowest field with "email" in its name, plus `website`/`domain`, skipping
  organiser, host, owner and team fields (`packages/core/src/suppression.ts`). Blocks the email and its company; a free
  email domain only blocks the email, and the client's own domains are never blocked. Query options: `reason` (default
  `form_submitted`), `block=both|email|domain`, `days`, `source`. Returns 422 with the field names when nothing usable is
  found
- **ActiveCampaign** (card on Suppression): for a client whose CRM is ActiveCampaign. With its API URL and key (encrypted),
  the worker reads the CRM every 10 minutes (`apps/worker/src/activecampaign-sync.ts`) and adds the primary contact of
  every deal in the chosen pipeline stages as `open_deal`, and every contact with one of the listed tags (e.g. a
  "Meeting Booked" tag the client's booking tool or automation applies) as `meeting_booked`: the email and its company
  domain, with the same free-email and own-domain rules as the webhook. Deals are matched by stage, not status, since
  accounts often keep won/lost as stages. Only adds: values already suppressed keep their reason, and nothing is removed
  when a deal or tag goes away. Runs in dry run too (it only writes this app's list); the blocklist sync above then
  copies the entries to Instantly
- **Test lead**: run any website and contact through the real pipeline, optionally without pushing, skipping the duplicate check, or re-reading the website
- **Variable lab**: run a client's AI variables against any website without creating a lead. Shows each output with the
  resolved placeholders, the shared research plan, source links and every check; regenerate one variable (plus those
  that depend on it), edit its instructions in place (saved to the client's settings), rewrite all with the same plan,
  re-plan from the stored website text, or re-read the website. Tests are kept in `variable_tests`
- **Webhook events**: every Happierleads payload as received, with errors and a Reprocess button
- **Integrations**: OpenAI API key (encrypted), model and token prices, and an optional Firecrawl key, shared by all
  clients and stored in `app_settings`. Each value saved here overrides `.env`; blank values fall back to `.env`. **Test key**
  checks the key and model with `GET /v1/models` (no tokens used).
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
pnpm db:seed      # prompt v1, the superadmin and, on an empty install, a demo client (dry run)
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
| `pnpm db:seed` | Idempotent: prompts and superadmin (re-run to change the admin password); the demo client only when no client exists, so a deleted demo stays deleted |
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

## AI variables: placeholders, rules and limits

Instructions can be plain text or a template. Inside `{{ }}` (parsed in `packages/shared/src/variable-template.ts`):

- **Lead data**: `{{firstName}}`, `{{lastName}}`, `{{fullName}}`, `{{companyName}}`, `{{website}}`, `{{domain}}`, `{{jobTitle}}`,
  `{{country}}`, `{{email}}`, with an optional fallback (`{{firstName|there}}`). Filled from the lead. Instantly's sending-account
  fields (`{{accountSignature}}`, `{{sendingAccountFirstName}}`, …) are kept as is for mail merge.
- **Another variable**: `{{value_proposition}}`. Makes this variable wait for that one and receive its finished text.
  "Written after" in Settings adds the same dependency without a placeholder; cycles are rejected on save.
- **Anything else is an instruction** the AI resolves from the research plan and the client's context, e.g.
  `{{companycategory}}`, `{{what we do}}`, `{{2-3 challenges}}`, `{{a named project and why it matters}}`. `{{industry}}` is in
  this group, so it is the AI's broader industry, not the raw Happierleads field.

Rules written in the instructions are read and checked: "exactly two sentences", "maximum of 85 words" / "under 40 words" /
"20-30 words", "no more than 200 characters", "Start with 'By the way,'", "Sentence two must start with 'And, I have
seen'", "Do not include a CTA". Word limits in the instructions win over the word fields; the "Exact sentences" and
"Must start with" fields win over the instructions. Every output is also checked for unresolved placeholders, brackets,
banned phrases, mentions of the visit, figures that are not in the website text or the approved proof, and cited details
that were not verified. Possibly unsupported names, missing personalisation and a detail reused by an unrelated
variable are shown as warnings.

Limitations:

- Facts are limited to what the crawler reads: the homepage plus up to 4 about/services/project/portfolio pages
  (12,000 characters). A project that only appears on deeper pages or in JavaScript-rendered content (without Firecrawl)
  is not found, and the writer stays general instead of naming it.
- Detail verification is textual: the quote or name must appear in the crawled text. It proves the site mentions it,
  not that every word the writer adds about it is correct. The "unsupported names" check is a heuristic and only warns.
- Challenges and benefits are interpretation by design; the prompt and the plan keep them apart from facts, but tone
  is not machine-checkable.
- Sentence counting uses punctuation and handles common abbreviations; unusual punctuation can miscount.
- Each lead costs one planner call plus one writer call per dependency layer, plus up to two correction calls. Lab
  costs are shown on the test but are not included in the dashboard's AI spend.
- Crawls stored before page URLs were kept have no sources; the lab re-reads such sites, the pipeline uses them as they are
  until the 30-day cache expires.
