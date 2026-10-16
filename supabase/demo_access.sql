begin;

do $$
begin
  if to_regprocedure('sck.complete_sale(uuid,integer,jsonb,uuid)') is null then
    raise exception '먼저 schema.sql과 migrations/20261016_core_integrity.sql을 실행해 주세요.';
  end if;
end $$;

grant usage on schema sck to anon, authenticated;

grant select, insert, update, delete on table
  sck.products,
  sck.inventory,
  sck.sales_logs,
  sck.movement_logs,
  sck.queues,
  sck.orders,
  sck.order_items,
  sck.store_settings
to anon, authenticated;

-- 순번 소비만 허용합니다. 시퀀스를 임의 값으로 변경하는 UPDATE는 주지 않습니다.
grant usage on sequence sck.queue_number_seq to anon, authenticated;

-- RPC 실행 권한은 위 마이그레이션에서 지정한 함수 목록을 그대로 사용합니다.
notify pgrst, 'reload schema';

commit;
