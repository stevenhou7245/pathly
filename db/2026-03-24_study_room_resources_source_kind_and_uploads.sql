begin;

alter table if exists public.study_room_resources
  add column if not exists source_kind text,
  add column if not exists file_name text,
  add column if not exists file_path text,
  add column if not exists file_size_bytes bigint,
  add column if not exists mime_type text;

alter table if exists public.study_room_resources
  alter column url drop not null;

update public.study_room_resources
set source_kind = coalesce(nullif(btrim(source_kind), ''), 'url')
where source_kind is null or btrim(source_kind) = '';

update public.study_room_resources
set resource_type = case lower(coalesce(resource_type, ''))
  when 'youtube' then 'video'
  when 'pdf' then 'document'
  when 'link' then 'website'
  when 'video' then 'video'
  when 'article' then 'article'
  when 'website' then 'website'
  when 'document' then 'document'
  when 'notes' then 'notes'
  when 'other' then 'other'
  else 'other'
end;

alter table if exists public.study_room_resources
  alter column source_kind set default 'url',
  alter column source_kind set not null;

alter table if exists public.study_room_resources
  drop constraint if exists study_room_resources_resource_type_check;

do $$
begin
  begin
    alter table public.study_room_resources
      add constraint study_room_resources_source_kind_check
      check (source_kind in ('url', 'file'));
  exception
    when duplicate_object then null;
  end;

  begin
    alter table public.study_room_resources
      add constraint study_room_resources_resource_type_check
      check (resource_type in ('video', 'article', 'website', 'document', 'notes', 'other'));
  exception
    when duplicate_object then null;
  end;
end $$;

create index if not exists idx_study_room_resources_room_source_kind
  on public.study_room_resources(room_id, source_kind, created_at desc);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'study-room-resources',
  'study-room-resources',
  true,
  52428800,
  array[
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;
