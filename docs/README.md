# Switchboard — resume tailoring with pull-request style review

Upload a resume and a job description; an AI proposes targeted changes, shown like a GitHub
diff (green = additions, red = removals, word-level highlights). Approve or reject each change;
the export contains only what you approved.

Flow: `/signup` → email verification → `/signin` → `/intake` → `/review?id=…` → `/export?id=…`

## Architecture

| Piece | Where |
| --- | --- |
| Auth (email/password, Google OAuth with PKCE, silent token refresh) | `app/api/auth/*`, `app/auth/callback`, `middleware.ts` |
| AI tailoring (server key: OpenAI/Anthropic; bring-your-own-key: OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Mistral) | `lib/tailoring/provider.ts`, `app/settings` |
| Matching model output to exact resume spans | `lib/tailoring/spans.ts` |
| Diff rendering (line + word level) | `lib/diff.ts`, `app/review/page.tsx` |
| Export assembly (position-based, approved changes only) | `lib/export/assemble.ts` |
| Persistence (Supabase REST + RLS in production, memory in demo) | `lib/server/store.ts` |
| PDF / DOCX / TXT text extraction | `lib/documents/validation.ts` |

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
```

For a zero-setup demo (no accounts, data in memory) set in `.env.local`:

```
NEXT_PUBLIC_APP_MODE=demo
NEXT_PUBLIC_DEMO_LOCAL_ONLY=true
```

Demo mode only works with `npm run dev`; production builds always require Supabase.

## Deploy (Vercel)

1. Apply the Supabase migrations in `supabase/migrations/` in order (`003_tailoring_persistence.sql`
   is required by this version).
2. In Vercel → Project → Settings → Environment Variables (Production), set:
   - `NEXT_PUBLIC_APP_MODE=production`
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY` **or** `OPENAI_API_KEY` (optional `ANTHROPIC_MODEL` / `OPENAI_MODEL`)
   - `TAILORING_PROVIDER=auto` (or delete it)
3. In Supabase → Authentication → URL Configuration, set **Site URL** to your Vercel domain and add
   `https://<your-domain>/**` to **Redirect URLs** (needed for email verification and Google).
4. For Google sign-in, enable the Google provider in Supabase → Authentication → Providers.
5. Redeploy.

## Checks

```bash
npm run typecheck
npm test
npm run lint
npm run build
```

## ATS match score

The review page shows an ATS-style score **before** tailoring, **now** (approved changes only,
updating live) and **if all suggestions are approved**; export shows before → after. The score is
deterministic and computed from the resume text (`lib/ats/score.ts`): job keywords found (70),
standard sections (10), job-title alignment (5), quantified bullets (5), contact details (5) and
length (5). Keywords come from the AI's matched + missing lists for the job. Users can tick missing
keywords they genuinely have; `POST /api/changes` adds them to the skills line as an approved
change (`lib/ats/add-skills.ts`), which is how a tailored resume reliably reaches 90+ without
inventing experience.

## Keeping the uploaded format

Uploaded resumes are stored privately and linked to the analysis (`resume_document_id`).
- **Word (.docx):** the export edits the user's own file in place (`lib/format/docx-edit.ts`):
  only the differing words are replaced inside the existing runs, removed lines drop their
  paragraph, and new lines are cloned from a neighbouring body paragraph, so fonts, styles,
  bullets, spacing, headers and footers are unchanged.
- **PDF:** at upload the layout is captured with pdf.js (`lib/format/pdf-layout.ts`): page size,
  margins and, per line, font, size, weight, alignment, indent and spacing. The final resume is
  rendered in that layout (`lib/format/styled.ts`) as a print-to-PDF page and as a .docx
  (`lib/format/docx-generate.ts`). This is a close reproduction, not a byte-level edit.
- **Pasted text:** a clean default layout.

## Analytics & SEO

- **Microsoft Clarity:** set `NEXT_PUBLIC_CLARITY_PROJECT_ID` (Clarity → Settings → Overview →
  Project ID). Resume text, job descriptions, the review diff, the export preview and API-key
  fields are marked `data-clarity-mask="True"` and are never recorded.
- **Google Search Console:** verify with a DNS TXT record (Domain property, recommended) or set
  `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` to the HTML-tag `content` value (URL-prefix property).
  Submit `https://switchboardapp.studio/sitemap.xml`. `robots.txt` allows the public pages and
  blocks the app, API and preview deployments.
- Link previews (WhatsApp, LinkedIn, X) use the Open Graph card in `app/opengraph-image.tsx`.

## Bring your own key

Users can open **AI settings** (`/settings`) and paste their own API key for any supported provider.
The key is kept in the browser's localStorage, sent with each analysis over HTTPS, used for that
request only, and never stored or logged on the server (provider error text is redacted). Analyses
made with a user's own key do not count towards the free allowance. Only the built-in provider
endpoints are allowed, so the server can't be pointed at arbitrary URLs.

## Payments (Dodo Payments)

Pro is a **one-time $9.99 purchase** (lifetime access). `Get Pro` on `/billing` creates a Dodo
hosted checkout (`lib/billing/dodo.ts`) tagged with the user's id. Dodo then calls
`/api/webhooks/dodo`, which verifies the Standard Webhooks signature, de-duplicates by
`webhook-id` (`public.billing_events`) and, on `payment.succeeded`, stores status `lifetime` in
`public.subscriptions` with the service role; a full `refund.succeeded` revokes it. When the
buyer returns from checkout the server also confirms the payment with Dodo directly
(`lib/billing/sync.ts`), so Pro activates even if the webhook is delayed. Subscription products
(`subscription.*` events) are also supported if you switch to a recurring price later.
`/api/billing/health` (signed in) reports whether each payment setting works.

Webhook events to enable in Dodo: `payment.succeeded`, `refund.succeeded` (and `subscription.*`
if you sell subscriptions).

Setup: create the subscription product and a webhook endpoint
(`https://<domain>/api/webhooks/dodo`) in Dodo, apply `supabase/migrations/004_dodo_payments.sql` and `005_one_time_purchase.sql`,
and set `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_SECRET`, `DODO_PAYMENTS_PRODUCT_ID`,
`DODO_PAYMENTS_ENVIRONMENT` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.

## Not built yet

- Native .docx/.pdf generation: exports are Word-compatible `.doc`, print-to-PDF, and `.txt`.
