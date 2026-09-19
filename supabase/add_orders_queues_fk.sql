-- orders.queue_id → queues.id 외래키 (PostgREST 조인용)
-- 이미 있으면 무시

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_queue_id_fkey'
  ) then
    alter table public.orders
      add constraint orders_queue_id_fkey
      foreign key (queue_id) references public.queues(id)
      on delete set null;
  end if;
exception
  when others then
    -- queue_id NOT NULL + cascade 등 환경 차이는 무시 (앱은 수동 조인 폴백)
    raise notice 'orders_queue_id_fkey skip: %', SQLERRM;
end $$;

-- sales_logs.order_id → orders.id (선택)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_logs_order_id_fkey'
  ) then
    alter table public.sales_logs
      add constraint sales_logs_order_id_fkey
      foreign key (order_id) references public.orders(id)
      on delete set null;
  end if;
exception
  when others then
    raise notice 'sales_logs_order_id_fkey skip: %', SQLERRM;
end $$;
