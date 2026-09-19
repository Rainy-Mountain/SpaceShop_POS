-- sales_logs ↔ queues 직접 연결 (대기열 손님 표기용, 선택)
alter table public.sales_logs
  add column if not exists queue_id uuid references public.queues(id) on delete set null;

create index if not exists sales_logs_queue_id_idx
  on public.sales_logs (queue_id);
