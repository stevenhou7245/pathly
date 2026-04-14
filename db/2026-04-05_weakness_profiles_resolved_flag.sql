alter table if exists public.weakness_profiles
  add column if not exists resolved boolean not null default false;

update public.weakness_profiles
set resolved = false
where resolved is null;

create index if not exists idx_weakness_profiles_user_course_resolved
  on public.weakness_profiles (user_id, course_id, resolved, updated_at desc);

