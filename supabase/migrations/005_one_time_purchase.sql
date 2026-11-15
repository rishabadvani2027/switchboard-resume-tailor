-- Pro is sold as a one-time purchase: a paid order is stored as status 'lifetime' with the
-- payment id, so a full refund can revoke it.
alter table public.subscriptions add column if not exists provider_payment_id text;
create index if not exists subscriptions_provider_payment_id_idx
  on public.subscriptions (provider_payment_id)
  where provider_payment_id is not null;
