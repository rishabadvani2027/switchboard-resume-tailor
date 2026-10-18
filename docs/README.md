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

## Bring your own key

Users can open **AI settings** (`/settings`) and paste their own API key for any supported provider.
The key is kept in the browser's localStorage, sent with each analysis over HTTPS, used for that
request only, and never stored or logged on the server (provider error text is redacted). Analyses
made with a user's own key do not count towards the free allowance. Only the built-in provider
endpoints are allowed, so the server can't be pointed at arbitrary URLs.

## Not built yet

- Card payments: the $9.99 plan shows "coming soon"; the free limit (3 analyses) is enforced
  server-side. Add Stripe Checkout + a webhook that writes `public.subscriptions`.
- Native .docx/.pdf generation: exports are Word-compatible `.doc`, print-to-PDF, and `.txt`.
