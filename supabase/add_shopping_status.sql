-- 스마트 오더: shopping 상태 추가 (Supabase SQL Editor에서 1회 실행)

alter table sck.orders drop constraint if exists orders_status_check;

alter table sck.orders
  add constraint orders_status_check
  check (status in ('shopping', 'pending', 'paid', 'cancelled', 'completed'));

alter table sck.orders alter column status set default 'shopping';
