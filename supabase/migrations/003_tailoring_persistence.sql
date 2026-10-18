-- Persist everything the review/export flow needs so the app works on serverless hosting
-- (Vercel), where in-memory state is lost between requests.

alter table public.analyses
  add column if not exists title text not null default '',
  add column if not exists source_text text not null default '',
  add column if not exists job_description text not null default '',
  add column if not exists insights jsonb not null default '{}'::jsonb,
  add column if not exists idempotency_key text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.analyses alter column provider set default 'unknown';

create unique index if not exists analyses_user_idempotency_key
  on public.analyses (user_id, idempotency_key)
  where idempotency_key is not null;
create index if not exists analyses_user_created_idx on public.analyses (user_id, created_at desc);

alter table public.changes drop constraint if exists changes_kind_check;
alter table public.changes add constraint changes_kind_check check (kind in ('edit', 'addition', 'removal'));
alter table public.changes add column if not exists position integer not null default 0;

alter table public.exports add column if not exists content text not null default '';

-- Users may read, create and update their own analyses, but not delete them:
-- completed analyses count towards the free allowance.
drop policy if exists "owner analyses" on public.analyses;
drop policy if exists "owner analyses select" on public.analyses;
drop policy if exists "owner analyses insert" on public.analyses;
drop policy if exists "owner analyses update" on public.analyses;
create policy "owner analyses select" on public.analyses for select using (user_id = auth.uid());
create policy "owner analyses insert" on public.analyses for insert with check (user_id = auth.uid());
create policy "owner analyses update" on public.analyses for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Changes: users may create and decide on their own changes, but not delete them.
drop policy if exists "owner changes" on public.changes;
drop policy if exists "owner changes select" on public.changes;
drop policy if exists "owner changes insert" on public.changes;
drop policy if exists "owner changes update" on public.changes;
create policy "owner changes select" on public.changes for select using (user_id = auth.uid());
create policy "owner changes insert" on public.changes for insert with check (user_id = auth.uid());
create policy "owner changes update" on public.changes for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Only the decision can change once a suggestion is stored.
create or replace function public.changes_only_status_updates()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.original is distinct from old.original
    or new.proposed is distinct from old.proposed
    or new.kind is distinct from old.kind
    or new.analysis_id is distinct from old.analysis_id
    or new.user_id is distinct from old.user_id then
    raise exception 'Only the status of a change can be updated';
  end if;
  return new;
end;
$$;
drop trigger if exists changes_only_status_updates on public.changes;
create trigger changes_only_status_updates before update on public.changes
  for each row execute function public.changes_only_status_updates();

-- Same for analyses: source text, provider output and the idempotency key are immutable.
create or replace function public.analyses_immutable_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source_text is distinct from old.source_text
    or new.job_description is distinct from old.job_description
    or new.user_id is distinct from old.user_id
    or new.status is distinct from old.status
    or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'Analysis content cannot be modified';
  end if;
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists analyses_immutable_fields on public.analyses;
create trigger analyses_immutable_fields before update on public.analyses
  for each row execute function public.analyses_immutable_fields();
