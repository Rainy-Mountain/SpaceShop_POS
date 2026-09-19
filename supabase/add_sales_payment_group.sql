-- sales_logs: 결제 건 그룹화 + 대기열 연결 (Supabase SQL Editor에서 1회 실행)
-- 손님 4자리·순번은 orders / queues 조인으로 표시. sales_logs.customer_name 은 사용하지 않음.

alter table public.sales_logs
  add column if not exists payment_group_id uuid;

alter table public.sales_logs
  add column if not exists order_id uuid references public.orders(id) on delete set null;

alter table public.sales_logs
  add column if not exists queue_id uuid references public.queues(id) on delete set null;

create index if not exists sales_logs_payment_group_id_idx
  on public.sales_logs (payment_group_id);

create index if not exists sales_logs_order_id_idx
  on public.sales_logs (order_id);

create index if not exists sales_logs_queue_id_idx
  on public.sales_logs (queue_id);
