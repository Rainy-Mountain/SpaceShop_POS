-- 스마트 오더 Realtime 활성화 (Supabase SQL Editor에서 1회 실행)
-- UPDATE 필터(id=eq.…), DELETE payload 를 위해 REPLICA IDENTITY FULL 필요

alter table sck.orders replica identity full;
alter table sck.order_items replica identity full;
alter table sck.queues replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table sck.orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table sck.order_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table sck.queues;
  exception when duplicate_object then null;
  end;
end $$;
