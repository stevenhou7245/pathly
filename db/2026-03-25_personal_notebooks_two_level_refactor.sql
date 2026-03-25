begin;

alter table if exists public.user_notebooks
  add column if not exists name text;

update public.user_notebooks
set name = coalesce(nullif(btrim(name), ''), nullif(btrim(topic), ''), 'My Notebook')
where coalesce(nullif(btrim(name), ''), '') = '';

alter table if exists public.user_notebooks
  alter column name set not null;

create table if not exists public.user_notebook_entries (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.user_notebooks(id) on delete cascade,
  topic text not null,
  content_md text null,
  source_type text not null default 'manual',
  source_room_id uuid null references public.study_rooms(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create table if not exists public.user_notebook_entry_items (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.user_notebook_entries(id) on delete cascade,
  source_kind text not null,
  source_id uuid null,
  author_user_id uuid null references public.users(id) on delete set null,
  title text null,
  content_md text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  begin
    alter table public.user_notebook_entries
      add constraint user_notebook_entries_source_type_check
      check (source_type in ('manual', 'study_room_exit_save', 'study_room_manual_save'));
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.user_notebook_entry_items
      add constraint user_notebook_entry_items_source_kind_check
      check (source_kind in ('study_room_note', 'study_room_resource', 'study_room_ai_exchange'));
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_user_notebook_entries_notebook_updated
  on public.user_notebook_entries(notebook_id, updated_at desc);

create index if not exists idx_user_notebook_entries_notebook_topic
  on public.user_notebook_entries(notebook_id, topic);

create index if not exists idx_user_notebook_entry_items_entry_created
  on public.user_notebook_entry_items(entry_id, created_at asc);

create or replace function public.set_user_notebook_entry_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_notebook_entries_set_updated_at
  on public.user_notebook_entries;

create trigger trg_user_notebook_entries_set_updated_at
before update on public.user_notebook_entries
for each row
execute function public.set_user_notebook_entry_updated_at();

-- Backfill: old single-level notebook rows -> first entry in two-level structure.
insert into public.user_notebook_entries (
  notebook_id,
  topic,
  content_md,
  source_type,
  source_room_id,
  created_at,
  updated_at,
  is_deleted
)
select
  n.id,
  coalesce(nullif(btrim(n.topic), ''), nullif(btrim(n.name), ''), 'Imported Entry'),
  n.content_md,
  coalesce(nullif(btrim(n.source_type), ''), 'manual'),
  n.source_room_id,
  coalesce(n.created_at, now()),
  coalesce(n.updated_at, now()),
  coalesce(n.is_deleted, false)
from public.user_notebooks n
where not exists (
  select 1
  from public.user_notebook_entries e
  where e.notebook_id = n.id
);

-- Backfill old item rows to entry-level item rows, preserving old id in metadata.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'user_notebook_items'
  ) then
    insert into public.user_notebook_entry_items (
      entry_id,
      source_kind,
      source_id,
      author_user_id,
      title,
      content_md,
      metadata,
      created_at
    )
    select
      e.id as entry_id,
      case
        when i.source_kind in ('study_room_note', 'study_room_resource', 'study_room_ai_exchange')
          then i.source_kind
        else 'study_room_note'
      end as source_kind,
      i.source_id,
      i.user_id,
      i.title,
      i.content_md,
      coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object('legacy_item_id', i.id),
      coalesce(i.created_at, now())
    from public.user_notebook_items i
    join lateral (
      select e2.id
      from public.user_notebook_entries e2
      where e2.notebook_id = i.notebook_id
      order by e2.created_at asc, e2.id asc
      limit 1
    ) e on true
    where not exists (
      select 1
      from public.user_notebook_entry_items ni
      where ni.metadata->>'legacy_item_id' = i.id::text
    );
  end if;
end $$;

commit;
