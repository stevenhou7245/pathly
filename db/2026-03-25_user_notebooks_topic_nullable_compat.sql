begin;

alter table if exists public.user_notebooks
  add column if not exists name text;

update public.user_notebooks
set name = coalesce(nullif(btrim(name), ''), nullif(btrim(topic), ''), 'My Notebook')
where coalesce(nullif(btrim(name), ''), '') = '';

alter table if exists public.user_notebooks
  alter column name set not null;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_notebooks'
      and column_name = 'topic'
      and is_nullable = 'NO'
  ) then
    alter table public.user_notebooks
      alter column topic drop not null;
  end if;
end $$;

commit;
