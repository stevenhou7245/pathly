begin;

create table if not exists study_rooms (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  style text not null default 'focus',
  max_participants integer not null default 10 check (max_participants >= 2),
  password text null,
  duration_minutes integer not null default 60 check (duration_minutes >= 15),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  ended_at timestamptz null
);

create table if not exists study_room_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  role text not null default 'participant'
);

create table if not exists study_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.study_rooms(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  type text not null default 'chat',
  created_at timestamptz not null default now()
);

alter table if exists study_rooms
  add column if not exists style text default 'focus',
  add column if not exists max_participants integer default 10,
  add column if not exists password text null,
  add column if not exists duration_minutes integer default 60,
  add column if not exists status text default 'active',
  add column if not exists created_at timestamptz default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists ended_at timestamptz;

alter table if exists study_room_participants
  add column if not exists joined_at timestamptz default now(),
  add column if not exists left_at timestamptz,
  add column if not exists role text default 'participant';

alter table if exists study_room_messages
  add column if not exists type text default 'chat',
  add column if not exists created_at timestamptz default now();

update study_rooms
set status = 'active'
where status is null or btrim(status) = '';

update study_rooms
set duration_minutes = 60
where duration_minutes is null or duration_minutes < 1;

update study_rooms
set max_participants = 10
where max_participants is null or max_participants < 1;

alter table if exists study_rooms
  alter column status set default 'active',
  alter column duration_minutes set default 60,
  alter column max_participants set default 10,
  alter column created_at set default now();

update study_rooms
set expires_at = created_at + make_interval(mins => greatest(duration_minutes, 1))
where expires_at is null;

update study_room_participants
set joined_at = now()
where joined_at is null;

update study_room_messages
set type = 'chat'
where type is null or btrim(type) = '';

update study_room_messages
set created_at = now()
where created_at is null;

-- Clean up orphan rows before adding/validating FKs.
delete from study_room_messages m
where not exists (select 1 from study_rooms r where r.id = m.room_id)
   or not exists (select 1 from users u where u.id = m.sender_id);

delete from study_room_participants p
where not exists (select 1 from study_rooms r where r.id = p.room_id)
   or not exists (select 1 from users u where u.id = p.user_id);

delete from study_rooms r
where not exists (select 1 from users u where u.id = r.creator_id);

-- Deduplicate participants by (room_id, user_id), keep the latest joined row.
with ranked as (
  select
    id,
    row_number() over (
      partition by room_id, user_id
      order by joined_at desc nulls last, id desc
    ) as rn
  from study_room_participants
)
delete from study_room_participants p
using ranked r
where p.id = r.id
  and r.rn > 1;

do $$
begin
  begin
    alter table study_rooms
      add constraint study_rooms_creator_id_fkey
      foreign key (creator_id) references public.users(id) on delete cascade;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table study_room_participants
      add constraint study_room_participants_room_id_fkey
      foreign key (room_id) references public.study_rooms(id) on delete cascade;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table study_room_participants
      add constraint study_room_participants_user_id_fkey
      foreign key (user_id) references public.users(id) on delete cascade;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table study_room_messages
      add constraint study_room_messages_room_id_fkey
      foreign key (room_id) references public.study_rooms(id) on delete cascade;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table study_room_messages
      add constraint study_room_messages_sender_id_fkey
      foreign key (sender_id) references public.users(id) on delete cascade;
  exception
    when duplicate_object then null;
  end;

  begin
    alter table study_room_participants
      add constraint study_room_participants_room_user_unique
      unique (room_id, user_id);
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_study_rooms_status_expires_at
  on study_rooms(status, expires_at);

create index if not exists idx_study_room_participants_room_id
  on study_room_participants(room_id);

create index if not exists idx_study_room_participants_user_id
  on study_room_participants(user_id);

create index if not exists idx_study_room_messages_room_id_created_at
  on study_room_messages(room_id, created_at asc);

create table if not exists study_room_invitations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references study_rooms(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  receiver_id uuid not null references users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz null
);

do $$
begin
  begin
    alter table study_room_invitations
      add constraint study_room_invitations_room_sender_receiver_key
      unique (room_id, sender_id, receiver_id);
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_study_room_invites_receiver_status
  on study_room_invitations(receiver_id, status, created_at desc);

create index if not exists idx_study_room_invites_room_id
  on study_room_invitations(room_id);

do $$
begin
  begin
    alter publication supabase_realtime add table public.study_rooms;
  exception
    when duplicate_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.study_room_participants;
  exception
    when duplicate_object then null;
    when undefined_table then null;
  end;

  begin
    alter publication supabase_realtime add table public.study_room_invitations;
  exception
    when duplicate_object then null;
    when undefined_table then null;
  end;
end $$;

commit;
