-- Keep the uploaded resume's format so the tailored resume can be returned in the same design.
alter table public.documents
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists layout jsonb;          -- PDF layout: page size, per-line fonts/sizes/alignment/spacing
alter table public.analyses
  add column if not exists resume_document_id uuid references public.documents(id) on delete set null;
