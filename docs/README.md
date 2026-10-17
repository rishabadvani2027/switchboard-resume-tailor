# Switchboard MVP

This is a local-first Next.js MVP for review-first resume tailoring. It runs in
explicit, local-only `demo` mode with no Supabase, billing, or provider credentials:

```bash
npm install
npm run dev
```

The flow is `/` → `/signin` → `/signup` → email verification → `/intake` → `/review` → `/export`. Demo mode uses
server-side in-memory analysis/change records and a deterministic mock provider.
Set `NEXT_PUBLIC_APP_MODE=production` only after the Supabase persistence,
billing, document parsers, and tailoring provider integrations are deployed;
protected routes and APIs fail closed rather than silently falling back to the
demo store.

Production sign-in and sign-up post to Supabase Auth action boundaries. Sign-up
requires email verification before protected routes can be accessed. Google
OAuth uses a state cookie plus a required S256 PKCE verifier. Missing or
mismatched callback state/verifiers are rejected. Analysis requests require a
caller-supplied idempotency key; request content is never used as an implicit
operation key. Provider results are validated for unique IDs, exact source
occurrences, kind semantics, and non-empty ready output before persistence.

Demo documents, analyses, and exports are server-side, in-memory records scoped
by the demo user for the lifetime of the server process. Export always reads the
stored analysis and decisions; client-supplied source or changes are ignored.
Production must replace these records with the Supabase tables and private
storage described in the migration before handling real documents.

Documents are stored in the private `private-documents` Supabase Storage bucket
under the authenticated user's folder. The bucket and server-side validation
reject files larger than 5 MB and allow only TXT, PDF, and DOCX MIME types.

Checks:

```bash
npm run typecheck
npm test
npm run build
```
