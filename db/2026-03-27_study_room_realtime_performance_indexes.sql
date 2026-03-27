-- Study Room realtime/read performance indexes
-- Safe to run repeatedly.

create index if not exists idx_study_room_messages_room_created_at
  on public.study_room_messages (room_id, created_at desc);

create index if not exists idx_study_room_messages_sender_id
  on public.study_room_messages (sender_id);

create index if not exists idx_study_room_participants_room_joined_at
  on public.study_room_participants (room_id, joined_at asc);

create index if not exists idx_study_room_participants_user_id
  on public.study_room_participants (user_id);

create index if not exists idx_study_room_note_entries_room_created_at
  on public.study_room_note_entries (room_id, created_at desc);

create index if not exists idx_study_room_note_entries_author_user_id
  on public.study_room_note_entries (author_user_id);

create index if not exists idx_study_room_resources_room_created_at
  on public.study_room_resources (room_id, created_at desc);

create index if not exists idx_study_room_resources_added_by
  on public.study_room_resources (added_by);

create index if not exists idx_study_room_ai_messages_room_created_at
  on public.study_room_ai_messages (room_id, created_at desc);

create index if not exists idx_study_room_ai_messages_linked_user_id
  on public.study_room_ai_messages (linked_user_id);
