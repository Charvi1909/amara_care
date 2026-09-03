# Amara — family caregiver coordination

A shared calendar and coordination app for families caring for a dependent:
tasks, claiming, handoffs, family votes to reschedule/cancel, an emergency
escalation flow (email the family's emergency contact + members), an AI
"chaos to calendar" extractor for WhatsApp screenshots, and an "Ask AI" tab
that finds real nearby services (pharmacy, hospital, transport…).

- **Frontend** — static `frontend/` (vanilla JS ES modules). Talks straight to
  Supabase (Auth + Postgres + Realtime) with the public anon key.
- **Backend** — one Express app (`server.mjs`) for the AI / email routes only:
  Gemini extraction, OpenStreetMap Nominatim lookups, Resend emails.

## Run locally

```bash
npm install
```

Create **`backend/.env`** (git-ignored) with:

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_KEY=<service_role or anon key>
GEMINI_API_KEY=<google ai studio key>
RESEND_API_KEY=<resend key>          # optional — only the emergency emails need it
```

Then:

```bash
npm start          # -> http://localhost:3000
```

The Supabase project for the frontend is already wired in
`frontend/supabaseClient.js` (public anon key), so the two halves connect to the
same database automatically.

### Supabase setup (once per project)

In the Supabase dashboard:

1. **Authentication → Providers → Email → turn OFF "Confirm email"** (so demo
   signups can log in immediately).
2. **SQL editor** — run the files in `backend/migrations/` in order. If the
   project is already partly set up, these three are the ones most likely
   missing:

   ```sql
   alter table public.tasks
     add column if not exists dependent_id uuid references public.dependents(id) on delete set null;
   alter table public.tasks
     add column if not exists emergency_final_at timestamptz;
   alter table public.users
     add column if not exists email text;
   ```
3. RLS is left **disabled** on all tables (hackathon scope — the frontend scopes
   every query by `family_id`).

## Deploy to Vercel (free / Hobby plan)

`vercel.json` and `api/index.mjs` are already set up: every request is routed to
the Express app, which serves both the static frontend and the `/api/*` routes.

1. Import the GitHub repo at [vercel.com/new](https://vercel.com/new). No build
   settings to change — leave the framework as **Other**.
2. **Settings → Environment Variables** — add the same four keys as
   `backend/.env` above (`SUPABASE_URL`, `SUPABASE_KEY`, `GEMINI_API_KEY`,
   `RESEND_API_KEY`).
3. Also add **`PUBLIC_BASE_URL`** = your deployment URL
   (e.g. `https://amara-care.vercel.app`) so the "I've got this" links in the
   emergency emails point at the live site instead of localhost.
4. Deploy. Redeploy after changing any env var.

Optional env vars: `DEMO_LOCATION` (default `Vellore`) and `DEMO_COUNTRY_CODE`
(default `in`) control where the "Ask AI" tab searches when a question names no
place.

### Notes / limits on Hobby

- Serverless functions cap at 30 s (`vercel.json`); Gemini + Nominatim calls
  finish well under that.
- Request bodies cap at ~4.5 MB, so the chaos extractor handles roughly 3–4
  screenshots at once, not 8.
- Uploaded images are written to `/tmp` and deleted right after Gemini reads
  them — nothing is stored.

## Tests

```bash
npm test                       # conflict / workload engine unit tests
node comprehensiveEdgeTests.mjs # same, against the live Supabase data
```

## Layout

```
server.mjs              Express app (AI + email routes); exported for Vercel
api/index.mjs           Vercel serverless entry (re-exports server.mjs)
extractTask.mjs         Gemini: single task from a text message
extractFromImage.mjs    Gemini: tasks from chat screenshots (+ dedupe)
backend/
  resourceAssistant.mjs "Ask AI" — Gemini keywords + Nominatim lookup
  conflictEngine.mjs    schedule-overlap detection
  workloadManager.mjs   caregiver load / burnout
  suggestionEngine.mjs  who should take a task
  taskMatch.mjs         duplicate-task detection
  crud.js               Supabase helpers (Node side)
  migrations/           SQL to run in the Supabase editor
frontend/
  index.html script.js  the app
  login.html            auth + family create/join
  api.js                browser data layer (Supabase + mappers + checks)
  engine/               vendored copies of backend/*.mjs (browser can't reach ../backend)
```
