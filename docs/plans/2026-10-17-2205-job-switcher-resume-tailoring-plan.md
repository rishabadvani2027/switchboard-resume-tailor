---
date: 2026-10-17
topic: job-switcher-resume-tailoring
product_contract_source: ce-plan-bootstrap
artifact_contract: ce-unified-plan/v1
execution: code
---

# Job-switcher resume tailoring

## Goal Capsule

### Objective

Help a job switcher create a truthful, role-specific resume from an existing resume and target job description, while keeping every generated change visible and under the user's control.

### Means

Build a minimal web app with email/password authentication, verified email and Google sign-in, resume/JD upload, a resume-tailoring analysis flow backed by the named `claude-resume-kit` resource, GitHub-style additions/removals review, approval-gated export, and a three-free-resume entitlement followed by a $9.99 subscription.

### Constraints

- The first three completed resume analyses/exports are free per account.
- Subscription access is required after the free allowance; pricing is $9.99, with billing provider details resolved during implementation.
- A final resume must not be generated until all proposed changes are approved or rejected.
- The UI must stay minimal, readable, and step-oriented.
- User documents are sensitive and must not be exposed across accounts.
- The external `https://github.com/ARPeeketi/claude-resume-kit` resource is authoritative input for tailoring behavior; if it is not directly executable in the chosen runtime, the implementation must use a clearly isolated adapter and record the limitation.

## Problem Frame

Generic AI rewriting and ATS scoring do not give job switchers enough control or trust. The app should make tailoring inspectable: identify proposed additions and removals against the target JD, let the candidate approve or reject each change, and export only the approved result.

## Scope Boundaries

### In scope

- Account creation and sign-in with email/password and Google OAuth.
- Verification gating for email/password accounts.
- Authenticated resume/JD intake with supported document upload and text extraction.
- Tailoring job creation and status tracking.
- Review screen with GitHub-style green additions and red removals.
- Per-change approval/rejection and final export only after every change has a decision.
- Free allowance accounting and a subscription paywall at $9.99 after three free resumes.
- Minimal responsive navigation, progress states, empty states, and actionable errors.
- Row-level ownership checks, private storage, and deletion of source documents after the configured retention period.

### Deferred to follow-up work

- Automatic job-board discovery, application submission, autofill, or recruiter messaging.
- Portfolio/evidence graph, interview preparation, job-quality scoring, and outcome analytics.
- Team accounts, admin dashboards, coupons, annual billing, and enterprise plans.
- Multi-document resume comparison beyond the current resume and one target JD.
- Guaranteed ATS compatibility claims.

### Non-goals

- Inventing experience, metrics, titles, credentials, or skills.
- Making applications on the user's behalf.
- Exposing a universal ATS score or promising interviews.

## Product Requirements

### R1. Authentication

Users can create an account with email/password, must verify the email before using protected app functionality, and can sign in with Google OAuth.

### R2. Resume and job description intake

An authenticated user can upload or paste one resume and one target JD. The app validates file type/size, extracts text, and shows a confirmation before analysis.

### R3. Tailoring analysis

The system sends normalized resume/JD text to an isolated tailoring adapter based on `claude-resume-kit`, records a processing status, and returns structured changes rather than an opaque rewritten document.

### R4. Reviewable diff

The review screen renders original content, additions, and removals with stable change identifiers, green additions, red removals, and accessible labels that do not rely on color alone.

### R5. Approval gate

Every proposed change must be approved or rejected. The export action remains unavailable while undecided changes exist. Rejected changes never appear in the final document.

### R6. Entitlements and payment

Each account receives three free resume analyses/exports. A fourth attempt requires an active $9.99 subscription. Entitlement checks are server-side and idempotent.

### R7. Privacy and ownership

Users can access only their own documents, analyses, changes, and exports. Source files and generated artifacts use private storage and signed, short-lived download URLs.

### R8. Usability

The primary flow is linear: sign in → upload → analyze → review → approve → export. Each screen has one primary action, clear progress, loading/error states, and mobile-compatible layout.

## Key Technical Decisions

### KTD1. Use a Next.js application with Supabase Auth, Postgres, and private Storage

**Decision:** Use the already-configured Supabase project for authentication, persistence, storage, and server-side authorization.  
**Rationale:** It provides email verification, Google OAuth, row-level security, signed URLs, and a single backend surface for an otherwise new project.  
**Alternative rejected:** Build a custom auth/API/storage stack.  
**Reason:** It increases security and operational scope without improving the core tailoring experience.

### KTD2. Treat tailoring as an asynchronous job with a provider adapter

**Decision:** Persist an analysis job and process it through a server-side adapter that can call or wrap `claude-resume-kit`, returning a validated structured diff.  
**Rationale:** External skill execution, retries, provider failures, and long-running analysis should not block the browser request.  
**Alternative rejected:** Run the skill directly in the browser or return a free-form rewritten resume.  
**Reason:** It would expose credentials/logic and make approval, retries, and validation unreliable.

### KTD3. Store atomic changes, not only rendered documents

**Decision:** Persist each change with original text, proposed text, section/order metadata, status, and source analysis version.  
**Rationale:** Atomic records support approval gating, deterministic export, auditability, and future provider replacement.  
**Alternative rejected:** Store only before/after document blobs.  
**Reason:** Blob-only storage cannot safely enforce per-change decisions or explain exports.

### KTD4. Enforce entitlements on the server and make billing webhook-driven

**Decision:** Store usage counters and subscription state in Postgres; payment webhooks update entitlement state idempotently; UI is advisory only.  
**Rationale:** Client counters are bypassable and payment redirects are not authoritative.  
**Alternative rejected:** Gate access with local storage or client-only state.  
**Reason:** It is insecure and loses state across devices.

## High-Level Technical Design

The system has five logical areas:

```text
Browser
  -> Next.js UI/server actions
      -> Supabase Auth / Postgres / private Storage
      -> Tailoring job adapter -> claude-resume-kit/provider
      -> Billing provider webhook -> entitlement records
```

Analysis state moves through `draft -> queued -> processing -> ready|failed`; review changes move through `pending -> approved|rejected`; an export is allowed only when no change remains `pending`.

The primary data flow is:

```text
resume + JD
  -> extracted text
  -> tailoring request
  -> validated structured changes
  -> user decisions
  -> approved document export
```

## Implementation Units

### U1. Bootstrap the application shell and design system

Create the Next.js TypeScript app structure, minimal layout, typography/color tokens, responsive shell, step indicator, button/input/error primitives, and route boundaries for auth, intake, review, export, and billing.

**Files:** `app/`, `components/ui/`, `lib/validation/`, `package.json`

**Tests:**

- Render each route at mobile and desktop widths and verify one clear primary action is visible.
- Verify loading, empty, error, and success states render without layout overflow.

### U2. Implement Supabase authentication and protected routing

Configure email/password registration, email verification handling, Google OAuth callback, session refresh, protected route middleware, and account sign-out.

**Files:** `app/(auth)/`, `app/auth/callback/`, `lib/supabase/`, `middleware.ts`

**Tests:**

- Register with an unverified email and verify protected routes redirect to the verification state.
- Sign in with a verified email and reach intake.
- Complete the Google callback with a mocked provider response and create a session.
- Verify unauthenticated requests cannot read protected data.

### U3. Add database schema, RLS policies, and private document storage

Create tables for profiles, documents, tailoring analyses, changes, exports, subscriptions, and usage ledger entries. Add ownership policies, private storage buckets, signed URL helpers, and retention/deletion helpers.

**Files:** `supabase/migrations/`, `lib/db/`, `lib/storage/`

**Tests:**

- A user can select only their own rows; a second user receives no rows for another user's IDs.
- Uploads reject unsupported type/size and store objects under an account-scoped path.
- Signed URLs expire and cannot be generated for another user's object.
- Usage ledger inserts are idempotent for the same analysis/export operation.

### U4. Build resume/JD intake and extraction

Implement upload and paste inputs, client validation, server-side extraction for the supported formats, preview/confirmation, and creation of a draft analysis.

**Files:** `app/(app)/intake/`, `app/api/documents/`, `lib/documents/`, `lib/validation/documents.ts`

**Tests:**

- Upload a valid resume and JD, preview extracted text, and create a draft analysis.
- Paste plain text for either input and preserve line breaks.
- Reject oversized, empty, and unsupported files with actionable messages.
- Refreshing or resubmitting the intake does not duplicate the same draft unintentionally.

### U5. Integrate the tailoring adapter and structured diff validation

Define the provider-neutral request/response schema, adapter boundary for `claude-resume-kit`, queue/processing transitions, retry/failure behavior, and validation that every returned change has stable IDs and valid original/proposed content.

**Files:** `lib/tailoring/`, `app/api/analyses/`, `supabase/functions/` or `app/api/jobs/`

**Tests:**

- A mocked adapter returns additions/removals and the analysis reaches `ready`.
- Provider timeout/rejection marks the analysis `failed` with a retry-safe error.
- Malformed provider output is rejected and never reaches review.
- Replaying the same job does not create duplicate changes.

### U6. Build GitHub-style review and approval workflow

Render section-aware diff blocks with green additions and red removals plus text labels, persist decisions, show progress, and disable export until no pending changes remain.

**Files:** `app/(app)/review/[analysisId]/`, `components/diff/`, `app/api/changes/`

**Tests:**

- Review displays additions/removals in stable order with accessible labels.
- Approving and rejecting individual changes persists across refresh.
- Export remains disabled with any pending change and becomes enabled only when all changes are decided.
- A rejected change is absent from the assembled final content.
- Concurrent decision updates do not overwrite a newer decision silently.

### U7. Assemble and export the approved resume

Build a deterministic assembler from the source document plus approved changes, generate a downloadable document, persist export metadata, and show the final approved version and audit summary.

**Files:** `lib/export/`, `app/(app)/export/[analysisId]/`, `app/api/exports/`

**Tests:**

- The same source plus decisions produces byte-stable text output.
- An export attempt with pending changes returns a server-side validation error even if the UI is bypassed.
- Exported content contains approved additions, excludes rejected changes, and preserves untouched content.
- Only the owning user can download the export.

### U8. Add free allowance, subscription checkout, and webhook entitlement updates

Implement server-side counting for the first three free completed analyses/exports, paywall messaging, $9.99 checkout, webhook signature verification, idempotent subscription updates, and subscription cancellation/expired handling.

**Files:** `app/(app)/billing/`, `app/api/billing/`, `lib/billing/`, `supabase/migrations/`

**Tests:**

- Accounts one through three eligible operations as free and blocks the fourth without an active subscription.
- A successful checkout webhook activates access; duplicate webhook delivery does not duplicate entitlement state.
- Failed, canceled, and expired subscriptions block new paid operations while preserving prior exports.
- A user cannot change their entitlement by editing client state or request parameters.

### U9. Add end-to-end flow coverage and operational safeguards

Cover the complete journey with browser tests, structured logging, rate limits around analysis and auth-sensitive endpoints, error reporting hooks, and accessible keyboard navigation.

**Files:** `tests/e2e/`, `lib/observability/`, `lib/rate-limit/`, `app/error.tsx`

**Tests:**

- New user completes email verification, uploads documents, reviews changes, approves all, and downloads an export.
- Google-authenticated user completes the same flow.
- Fourth analysis reaches the paywall and a mocked subscription returns to intake.
- Keyboard-only review can decide every change and reach export.
- Provider failure, upload failure, and expired session produce recoverable UI states.

## Verification Contract

- Run typecheck, lint, unit tests, database migration checks, and browser tests.
- Verify RLS with two distinct test users.
- Verify the server rejects export with pending changes and rejects paid operations without entitlement.
- Verify no generated claim bypasses the structured change schema.
- Run an accessibility smoke pass over auth, intake, review, billing, and export.

## Assumptions

- A billing provider will be selected during implementation; Stripe is the default candidate if no project constraint exists.
- The app will initially support PDF/DOCX upload plus pasted text, with exact parser support confirmed during implementation.
- The named resume skill may require a server-side bridge or manual adapter; no client-side execution or unvalidated free-form output is acceptable.
- Subscription price is interpreted as a monthly $9.99 plan unless the billing provider or user specifies otherwise.
- The first three free allowance is counted per completed analysis/export operation, not per draft upload.

## Definition of Done

- A new user can sign up, verify email or use Google, and reach intake.
- A user can provide a resume and JD, run tailoring, and see a structured GitHub-style diff.
- Every change can be approved or rejected, and export is impossible until all are decided.
- Final output contains only approved changes and is downloadable privately.
- The first three eligible operations are free; later operations require an active $9.99 subscription enforced server-side.
- Ownership, private storage, signed downloads, and RLS tests pass.
- Typecheck, lint, unit tests, and browser flow tests pass.
