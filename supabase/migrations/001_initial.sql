create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('resume', 'job_description')),
  storage_path text,
  extracted_text text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','queued','processing','ready','failed')),
  provider text not null default 'mock-claude-resume-kit-adapter',
  created_at timestamptz not null default now()
);
create unique index if not exists analyses_id_user_id_key on public.analyses (id, user_id);
create table if not exists public.changes (
  id text not null,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  section text not null,
  kind text not null check (kind in ('addition','removal')),
  original text not null,
  proposed text not null,
  rationale text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  primary key (analysis_id, id)
);
alter table public.changes
  add constraint changes_analysis_owner_fk
  foreign key (analysis_id, user_id) references public.analyses (id, user_id) on delete cascade;
create table if not exists public.exports (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text,
  created_at timestamptz not null default now()
);
alter table public.exports
  add constraint exports_analysis_owner_fk
  foreign key (analysis_id, user_id) references public.analyses (id, user_id) on delete cascade;
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inactive',
  provider_customer_id text unique,
  updated_at timestamptz not null default now()
);
create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_key text not null,
  operation text not null check (operation in ('analysis','export')),
  created_at timestamptz not null default now(),
  unique (user_id, operation_key)
);

alter table public.profiles enable row level security;
alter table public.documents enable row level security;
alter table public.analyses enable row level security;
alter table public.changes enable row level security;
alter table public.exports enable row level security;
alter table public.subscriptions enable row level security;
alter table public.usage_ledger enable row level security;

create policy "owner profiles" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "owner documents" on public.documents for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner analyses" on public.analyses for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner changes" on public.changes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner exports" on public.exports for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "owner subscriptions" on public.subscriptions for select using (user_id = auth.uid());
create policy "owner usage" on public.usage_ledger for select using (user_id = auth.uid());

insert into storage.buckets (id, name, public) values ('private-documents', 'private-documents', false) on conflict (id) do nothing;
create policy "private document owner read" on storage.objects for select using (bucket_id = 'private-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "private document owner write" on storage.objects for insert with check (bucket_id = 'private-documents' and (storage.foldername(name))[1] = auth.uid()::text);
