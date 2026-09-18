-- 스마트 오더 Realtime 활성화 (Supabase SQL Editor에서 1회 실행)
-- UPDATE 필터(id=eq.…), DELETE payload 를 위해 REPLICA IDENTITY FULL 필요

alter table public.orders replica identity full;
alter table public.order_items replica identity full;
alter table public.queues replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.order_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.queues;
  exception when duplicate_object then null;
  end;
end $$;
