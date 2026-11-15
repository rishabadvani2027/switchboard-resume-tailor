-- Dodo Payments subscriptions. Rows in public.subscriptions are written only by the
-- server-side webhook handler (service role); users can read their own row (existing policy).

alter table public.subscriptions
  add column if not exists provider_subscription_id text,
  add column if not exists product_id text,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;

create unique index if not exists subscriptions_provider_subscription_id_key
  on public.subscriptions (provider_subscription_id)
  where provider_subscription_id is not null;

-- Processed webhook ids, so a redelivered webhook is applied only once.
-- RLS is on with no policies: only the service role can read or write it.
create table if not exists public.billing_events (
  id text primary key,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
alter table public.billing_events enable row level security;
