begin;

drop table if exists study_session_messages cascade;
drop table if exists study_sessions cascade;
drop table if exists study_invitations cascade;

create table if not exists study_rooms (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references users(id) on delete cascade,
  name text not null,
  style text not null default 'focus',
  max_participants integer not null default 8 check (max_participants >= 2),
  password text not null,
  duration_minutes integer not null default 60 check (duration_minutes >= 15),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  ended_at timestamptz null
);

create table if not exists study_room_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references study_rooms(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  role text not null default 'participant'
);

create index if not exists idx_study_room_participants_room_id
  on study_room_participants(room_id);

create index if not exists idx_study_room_participants_user_id
  on study_room_participants(user_id);

create table if not exists study_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references study_rooms(id) on delete cascade,
  sender_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  type text not null default 'chat'
);

create index if not exists idx_study_room_messages_room_id_created_at
  on study_room_messages(room_id, created_at asc);

commit;

