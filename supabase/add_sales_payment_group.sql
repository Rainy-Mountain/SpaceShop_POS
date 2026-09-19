-- sales_logs: 결제 건 그룹화용 컬럼 (Supabase SQL Editor에서 1회 실행)

alter table public.sales_logs
  add column if not exists payment_group_id uuid;

alter table public.sales_logs
  add column if not exists order_id uuid references public.orders(id) on delete set null;

alter table public.sales_logs
  add column if not exists customer_name text;

create index if not exists sales_logs_payment_group_id_idx
  on public.sales_logs (payment_group_id);

create index if not exists sales_logs_order_id_idx
  on public.sales_logs (order_id);
