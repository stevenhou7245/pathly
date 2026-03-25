begin;

do $$
begin
  begin
    alter publication supabase_realtime add table public.study_room_messages;
  exception
    when duplicate_object then
      null;
    when undefined_table then
      null;
  end;

  begin
    alter publication supabase_realtime add table public.direct_messages;
  exception
    when duplicate_object then
      null;
    when undefined_table then
      null;
  end;
end $$;

commit;

