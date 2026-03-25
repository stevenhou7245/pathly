begin;

alter table if exists public.study_room_participants
  add column if not exists presence_state text default 'online',
  add column if not exists focus_mode boolean default false,
  add column if not exists focus_started_at timestamptz null,
  add column if not exists last_active_at timestamptz default now(),
  add column if not exists current_streak_seconds integer default 0,
  add column if not exists total_focus_seconds integer default 0,
  add column if not exists session_seconds integer default 0,
  add column if not exists goal_text text null,
  add column if not exists goal_status text default 'not_started';

update public.study_room_participants
set
  presence_state = coalesce(nullif(btrim(presence_state), ''), 'online'),
  focus_mode = coalesce(focus_mode, false),
  last_active_at = coalesce(last_active_at, joined_at, now()),
  current_streak_seconds = greatest(0, coalesce(current_streak_seconds, 0)),
  total_focus_seconds = greatest(0, coalesce(total_focus_seconds, 0)),
  session_seconds = greatest(0, coalesce(session_seconds, 0)),
  goal_status = coalesce(nullif(btrim(goal_status), ''), 'not_started');

do $$
begin
  begin
    alter table public.study_room_participants
      add constraint study_room_participants_presence_state_check
      check (presence_state in ('online', 'idle', 'focus', 'offline'));
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.study_room_participants
      add constraint study_room_participants_goal_status_check
      check (goal_status in ('not_started', 'in_progress', 'completed'));
  exception
    when duplicate_object then null;
  end;
end $$;

create table if not exists public.study_room_notes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null unique references public.study_rooms(id) on delete cascade,
  content text not null default '',
  updated_by uuid null references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_room_resources (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  resource_type text not null,
  title text not null,
  url text not null,
  added_by uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

do $$
begin
  begin
    alter table public.study_room_resources
      add constraint study_room_resources_resource_type_check
      check (resource_type in ('link', 'pdf', 'youtube'));
  exception
    when duplicate_object then null;
  end;
end $$;

create table if not exists public.study_room_ai_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  sender_id uuid null references public.users(id) on delete set null,
  role text not null default 'user',
  body text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

do $$
begin
  begin
    alter table public.study_room_ai_messages
      add constraint study_room_ai_messages_role_check
      check (role in ('user', 'assistant', 'system'));
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_study_room_participants_presence
  on public.study_room_participants(room_id, presence_state, last_active_at desc);

create index if not exists idx_study_room_resources_room_id_created_at
  on public.study_room_resources(room_id, created_at desc);

create index if not exists idx_study_room_ai_messages_room_id_created_at
  on public.study_room_ai_messages(room_id, created_at asc);

do $$
begin
  begin
    alter publication supabase_realtime add table public.study_room_notes;
  exception
    when duplicate_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.study_room_resources;
  exception
    when duplicate_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.study_room_ai_messages;
  exception
    when duplicate_object then null;
    when undefined_table then null;
  end;
end $$;

commit;
