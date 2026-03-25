begin;

create table if not exists public.user_notebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  topic text not null,
  content_md text null,
  source_type text not null default 'manual',
  source_room_id uuid null references public.study_rooms(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create table if not exists public.user_notebook_items (
  id uuid primary key default gen_random_uuid(),
  notebook_id uuid not null references public.user_notebooks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  source_kind text not null,
  source_id uuid null,
  source_room_id uuid null references public.study_rooms(id) on delete set null,
  title text null,
  content_md text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

do $$
begin
  begin
    alter table public.user_notebooks
      add constraint user_notebooks_source_type_check
      check (source_type in ('manual', 'study_room_exit_save', 'study_room_manual_save'));
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.user_notebook_items
      add constraint user_notebook_items_source_kind_check
      check (source_kind in ('study_room_note', 'study_room_resource', 'study_room_ai_exchange'));
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_user_notebooks_user_updated
  on public.user_notebooks(user_id, updated_at desc);

create index if not exists idx_user_notebooks_user_topic
  on public.user_notebooks(user_id, topic);

create index if not exists idx_user_notebook_items_notebook
  on public.user_notebook_items(notebook_id, created_at asc);

create index if not exists idx_user_notebook_items_user_room
  on public.user_notebook_items(user_id, source_room_id, created_at desc);

create or replace function public.set_user_notebook_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_notebooks_set_updated_at
  on public.user_notebooks;

create trigger trg_user_notebooks_set_updated_at
before update on public.user_notebooks
for each row
execute function public.set_user_notebook_updated_at();

drop trigger if exists trg_user_notebook_items_set_updated_at
  on public.user_notebook_items;

create trigger trg_user_notebook_items_set_updated_at
before update on public.user_notebook_items
for each row
execute function public.set_user_notebook_updated_at();

commit;
