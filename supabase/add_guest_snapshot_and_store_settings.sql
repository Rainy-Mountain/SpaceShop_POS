-- 결제 영수증용 손님 스냅샷 (queues/orders 조인 없이도 표기)
alter table public.sales_logs
  add column if not exists guest_customer_name text;

alter table public.sales_logs
  add column if not exists guest_queue_number integer;

-- 현장 설정 (단일 행)
create table if not exists public.store_settings (
  id integer primary key default 1 check (id = 1),
  auto_enter boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.store_settings (id, auto_enter)
values (1, false)
on conflict (id) do nothing;

alter table public.store_settings replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.store_settings;
  exception when duplicate_object then null;
  end;
end $$;
