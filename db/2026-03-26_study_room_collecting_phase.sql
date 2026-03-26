begin;

alter table if exists public.study_rooms
  add column if not exists closure_started_at timestamptz null,
  add column if not exists collection_deadline_at timestamptz null;

alter table if exists public.study_room_participants
  add column if not exists collection_status text null,
  add column if not exists collection_completed_at timestamptz null;

do $$
begin
  begin
    alter table public.study_rooms drop constraint if exists study_rooms_status_check;
  exception
    when undefined_object then null;
  end;

  begin
    alter table public.study_rooms
      add constraint study_rooms_status_check
      check (status in ('active', 'collecting', 'closed', 'expired'));
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.study_room_participants drop constraint if exists study_room_participants_collection_status_check;
  exception
    when undefined_object then null;
  end;

  begin
    alter table public.study_room_participants
      add constraint study_room_participants_collection_status_check
      check (collection_status is null or collection_status in ('completed', 'skipped'));
  exception
    when duplicate_object then null;
  end;
end $$;

update public.study_rooms
set closure_started_at = coalesce(ended_at, expires_at, created_at, now())
where closure_started_at is null
  and status in ('collecting', 'closed', 'expired');

update public.study_rooms
set collection_deadline_at = closure_started_at + interval '15 minutes'
where status = 'collecting'
  and closure_started_at is not null
  and collection_deadline_at is null;

update public.study_room_participants
set collection_status = 'completed',
    collection_completed_at = coalesce(collection_completed_at, left_at, now())
where left_at is not null
  and (collection_status is null or btrim(collection_status) = '');

create index if not exists idx_study_rooms_status_collection_deadline
  on public.study_rooms(status, collection_deadline_at);

create index if not exists idx_study_room_participants_room_left_collection
  on public.study_room_participants(room_id, left_at, collection_status);

commit;
