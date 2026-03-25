begin;

create table if not exists public.study_room_ai_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  sender_id uuid null references public.users(id) on delete set null,
  sender_type text not null default 'user',
  role text not null default 'user',
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.study_room_ai_messages
  add column if not exists sender_type text,
  add column if not exists metadata jsonb,
  add column if not exists updated_at timestamptz,
  add column if not exists role text;

update public.study_room_ai_messages
set role = case
  when coalesce(nullif(btrim(role), ''), '') in ('user', 'assistant', 'system') then role
  when coalesce(nullif(btrim(sender_type), ''), '') in ('user', 'assistant', 'system') then sender_type
  else 'user'
end
where role is null or btrim(role) = '' or role not in ('user', 'assistant', 'system');

update public.study_room_ai_messages
set sender_type = case
  when coalesce(nullif(btrim(sender_type), ''), '') in ('user', 'assistant', 'system') then sender_type
  when coalesce(nullif(btrim(role), ''), '') in ('user', 'assistant', 'system') then role
  else 'user'
end
where sender_type is null or btrim(sender_type) = '' or sender_type not in ('user', 'assistant', 'system');

update public.study_room_ai_messages
set metadata = '{}'::jsonb
where metadata is null;

update public.study_room_ai_messages
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table if exists public.study_room_ai_messages
  alter column role set default 'user',
  alter column role set not null,
  alter column sender_type set default 'user',
  alter column sender_type set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table if exists public.study_room_ai_messages
  drop constraint if exists study_room_ai_messages_role_check;

do $$
begin
  begin
    alter table public.study_room_ai_messages
      add constraint study_room_ai_messages_role_check
      check (role in ('user', 'assistant', 'system'));
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.study_room_ai_messages
      add constraint study_room_ai_messages_sender_type_check
      check (sender_type in ('user', 'assistant', 'system'));
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_study_room_ai_messages_room_created
  on public.study_room_ai_messages(room_id, created_at asc);

commit;
