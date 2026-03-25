begin;

alter table if exists public.study_room_ai_messages
  add column if not exists metadata jsonb,
  add column if not exists linked_user_id uuid references public.users(id) on delete set null,
  add column if not exists message_kind text,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists context_summary text,
  add column if not exists updated_at timestamptz,
  add column if not exists sender_type text;

update public.study_room_ai_messages
set metadata = '{}'::jsonb
where metadata is null;

update public.study_room_ai_messages
set sender_type = case
  when lower(coalesce(sender_type, '')) = 'assistant' then 'ai'
  when lower(coalesce(sender_type, '')) in ('user', 'ai', 'system') then lower(sender_type)
  when lower(coalesce(role, '')) = 'assistant' then 'ai'
  when lower(coalesce(role, '')) = 'system' then 'system'
  else 'user'
end
where sender_type is null
   or btrim(sender_type) = ''
   or lower(sender_type) not in ('user', 'ai', 'system');

update public.study_room_ai_messages
set message_kind = case
  when lower(coalesce(message_kind, '')) in ('chat', 'question', 'answer', 'summary')
    then lower(message_kind)
  when lower(coalesce(sender_type, '')) = 'ai' then 'answer'
  when lower(coalesce(sender_type, '')) = 'user' then 'question'
  else 'chat'
end
where message_kind is null
   or btrim(message_kind) = ''
   or lower(message_kind) not in ('chat', 'question', 'answer', 'summary');

update public.study_room_ai_messages
set linked_user_id = coalesce(linked_user_id, sender_id)
where linked_user_id is null;

update public.study_room_ai_messages
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table if exists public.study_room_ai_messages
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null,
  alter column sender_type set default 'user',
  alter column sender_type set not null,
  alter column message_kind set default 'chat',
  alter column message_kind set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table if exists public.study_room_ai_messages
  drop constraint if exists study_room_ai_messages_sender_type_check;

alter table if exists public.study_room_ai_messages
  drop constraint if exists study_room_ai_messages_message_kind_check;

do $$
begin
  begin
    alter table public.study_room_ai_messages
      add constraint study_room_ai_messages_sender_type_check
      check (sender_type in ('user', 'ai', 'system'));
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.study_room_ai_messages
      add constraint study_room_ai_messages_message_kind_check
      check (message_kind in ('chat', 'question', 'answer', 'summary'));
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_study_room_ai_messages_room_linked_user_created
  on public.study_room_ai_messages (room_id, linked_user_id, created_at desc);

create index if not exists idx_study_room_ai_messages_room_kind_created
  on public.study_room_ai_messages (room_id, message_kind, created_at desc);

commit;
