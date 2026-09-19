-- orders: 결제 시점 손님 스냅샷 (queues 삭제 후에도 영수증 유지)
alter table public.orders
  add column if not exists customer_name text;

alter table public.orders
  add column if not exists queue_number integer;

-- 기존 행 중 null 이면 기본값 (NOT NULL 제약이 있는 환경 대비)
update public.orders
set customer_name = coalesce(nullif(trim(customer_name), ''), '워크인')
where customer_name is null;

update public.orders
set queue_number = coalesce(queue_number, 0)
where queue_number is null;
