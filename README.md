# ReachPilot

Mission-control console for automated LinkedIn recruiter outreach. Feed it a role and a LinkedIn
search query — it opens a real Chromium browser, finds genuine hiring posts, filters out
bench-sales noise, optionally tailors your resume per JD with Groq, and emails the recruiters it
finds in the posts through your Gmail.

## How a run works

There is only one mode — **live**. Every run opens the real browser and sends real emails.

1. **New Chromium tab** — every run opens a new Chromium window + tab (Playwright).
2. **Logged in directly** — the browser uses a persistent profile (`linkedin_saved_login/`).
   The very first run waits for you to sign in once in the opened window (up to
   `LINKEDIN_LOGIN_WAIT_SEC`, default 5 min); the login is stored, and every future run starts
   already logged in.
3. **Search** — your LinkedIn search query runs in the posts tab; the bot scrolls, expands
   "…more" text, and reads post cards.
4. **Filters** — only posts that look like real job requirements *and* match your role pass.
   Bench-sales / hotlist posts are auto-blocked; your own / CC / BCC addresses are never contacted.
5. **Email dispatch** — for each valid post, the recruiter email(s) written **in the post** are
   extracted, normalized and validated. A formatted application (subject, HTML + text body,
   resume PDF attached, source-post link) is sent via Gmail SMTP. Nothing is ever emailed to a
   hardcoded address — only emails found in genuine posts.
6. **De-duplication** — a unique `(email, postLink)` index in the database makes double-sends
   impossible, even across runs.

## Quick start

```bash
npm install
npx playwright install chromium   # one-time: downloads the Chromium browser
cp .env.example .env              # then fill in your values
npm run build && npm start        # or: npm run dev
```

Open http://localhost:3000 → **New Run** → answer the steps (role, search query, max emails,
AI resume tailoring) and launch. The run opens the Chromium tab, scrapes LinkedIn, and sends
real emails through Gmail (requires `GMAIL_ID` + `GMAIL_APP_PASSWORD`). To test with minimal
risk, launch a run with **1–2 max emails**.

## Environment (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `GMAIL_ID` | — | Your Gmail address (sender). Required for live sends. |
| `GMAIL_APP_PASSWORD` | — | Gmail **app password** (Google Account → Security → App passwords). |
| `GROQ_API_KEY` | — | Enables per-JD resume tailoring + skill matching. Optional. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq chat model. |
| `LINKEDIN_PROFILE_DIR` | `linkedin_saved_login` | Chromium persistent profile (stores your LinkedIn login). Gitignored. |
| `LINKEDIN_LOGIN_WAIT_SEC` | `300` | How long the first run waits for a manual LinkedIn sign-in. |
| `SCRAPER_HEADLESS` | — | Set `1` on machines without a display. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017` | Real MongoDB. If unreachable, an embedded in-memory MongoDB is used (data resets on restart). |
| `MONGODB_DB` | `reachpilot` | Database name. |
| `MONGODB_DISABLE_EMBEDDED` | — | Set `1` to never fall back to the embedded DB. |
| `CANDIDATE_NAME` / `CANDIDATE_EMAIL` / `CANDIDATE_PHONE` / `CANDIDATE_LINKEDIN` | — | Your identity — used in subject line, email body, and generated resume. |
| `CANDIDATE_LOCATION` / `CANDIDATE_RELOCATION` / `CANDIDATE_WORK_AUTH` / `CANDIDATE_AVAILABILITY` / `CANDIDATE_EXPERIENCE` / `CANDIDATE_EXPECTED_RATE` | — | Submission-details block in every email. |
| `CC_EMAILS` / `BCC_EMAILS` | — | Comma/space-separated; skipped when empty. |
| `RESUME_FILENAME` | `Resume.pdf` | Drop your own resume into `output/` with this name to use it instead of the generated one. |
| `MAX_EMAILS_PER_ROLE` | `15` | Default target per run. |
| `DELAY_BETWEEN_EMAILS` | `12` | Seconds between real sends. |
| `SCROLL_ROUNDS` | `8` | How many scroll passes the scraper makes. |
| `WAIT_BETWEEN_ROLES_MIN` / `WAIT_BETWEEN_ROLES_MAX` | `60` / `120` | Reserved for multi-role rotation (shown in Settings). |
| `DAILY_RESPONSE_TARGET` | `20` | Display-only daily response goal on the dashboard. |

## Project structure

```
src/
├── app/               # Next.js App Router: pages + API routes
│   ├── page.tsx       # Console dashboard
│   ├── run/new/       # 5-step launch wizard
│   ├── run/[id]/      # Live run console (streaming log, stop button)
│   ├── history/       # Outbox table + CSV export
│   ├── settings/      # Read-only .env view (masked secrets)
│   └── api/           # health, runs (+stop), sent, stats, settings
├── engine/
│   ├── runner.ts      # Orchestrator: state machine, dedupe, delays, stop handling
│   ├── scraper.ts     # Playwright Chromium flow: new tab, login-once, search, extract
│   └── sender.ts      # Gmail SMTP via nodemailer
├── lib/
│   ├── config.ts      # Env parsing
│   ├── filters.ts     # Email extraction/validation, bench-sales + role filters
│   ├── email.ts       # Subject / HTML / text templates
│   ├── groq.ts        # Skill matching + strict-JSON resume tailoring
│   └── resume.ts      # Base resume profile + pdfkit rendering (output/)
└── db/index.ts        # MongoDB (native driver) with embedded in-memory fallback
```

## Safety notes

- **Every run is a live send** — configure Gmail carefully and test with a small max-emails count.
- Emails are only ever addressed to addresses found inside genuine, role-relevant posts.
- Real sends are rate-limited (`DELAY_BETWEEN_EMAILS`) and double-send protection is
  database-enforced (unique index), not just in-memory.
- The LinkedIn session profile and `.env` are gitignored — never commit credentials.
