begin;

alter table if exists public.study_room_notes
  add column if not exists content_md text null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_room_notes'
      and column_name = 'content'
  ) then
    update public.study_room_notes
    set content_md = nullif(content, '')
    where content_md is null;
  end if;
end $$;

alter table if exists public.study_room_notes
  alter column content_md drop not null;

create table if not exists public.study_room_note_entries (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  author_user_id uuid not null references public.users(id) on delete cascade,
  content_md text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create index if not exists idx_study_room_note_entries_room_id
  on public.study_room_note_entries(room_id);

create index if not exists idx_study_room_note_entries_author_user_id
  on public.study_room_note_entries(author_user_id);

create index if not exists idx_study_room_note_entries_room_author
  on public.study_room_note_entries(room_id, author_user_id);

create index if not exists idx_study_room_note_entries_room_created
  on public.study_room_note_entries(room_id, created_at desc);

create or replace function public.set_study_room_note_entry_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_study_room_note_entries_set_updated_at
  on public.study_room_note_entries;

create trigger trg_study_room_note_entries_set_updated_at
before update on public.study_room_note_entries
for each row
execute function public.set_study_room_note_entry_updated_at();

do $$
begin
  begin
    alter publication supabase_realtime add table public.study_room_note_entries;
  exception
    when duplicate_object then null;
    when undefined_table then null;
  end;
end $$;

commit;
