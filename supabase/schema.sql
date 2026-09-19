-- products / inventory / sales_logs / movement_logs 예시 스키마

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  brand text not null default '미지정',
  name text not null unique,
  company_type text not null default '자사' check (company_type in ('자사', '타사')),
  price numeric not null default 0,
  liquor_type text,
  created_at timestamptz not null default now()
);

-- 기존 DB에 liquor_type이 없다면 실행
-- alter table products add column if not exists liquor_type text;

create table if not exists inventory (
  product_id uuid primary key references products(id) on delete cascade,
  backup_qty integer not null default 0,
  storage_qty integer not null default 0,
  display_qty integer not null default 0,
  last_updated timestamptz not null default now()
);

create table if not exists sales_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  day_number integer not null check (day_number between 1 and 3),
  sold_from text not null check (sold_from in ('차량', '창고', '진열')),
  quantity integer not null check (quantity > 0),
  total_price numeric not null default 0,
  payment_group_id uuid,
  order_id uuid,
  customer_name text,
  created_at timestamptz not null default now()
);

-- 결제 건 그룹화 컬럼 (기존 DB: add_sales_payment_group.sql 실행)
-- alter table sales_logs add column if not exists payment_group_id uuid;
-- alter table sales_logs add column if not exists order_id uuid;
-- alter table sales_logs add column if not exists customer_name text;

create table if not exists movement_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  from_location text not null check (from_location in ('차량', '창고', '진열')),
  to_location text not null check (to_location in ('차량', '창고', '진열')),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

-- 스마트 오더 대기열
create table if not exists queues (
  id uuid primary key default gen_random_uuid(),
  queue_number integer not null,
  customer_name text not null,
  status text not null default 'waiting'
    check (status in ('waiting', 'entered', 'ordering', 'completed', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists queues_queue_number_idx on queues (queue_number desc);

-- 기존 DB: entered 상태 허용 (1회 실행)
-- alter table queues drop constraint if exists queues_status_check;
-- alter table queues add constraint queues_status_check
--   check (status in ('waiting', 'entered', 'ordering', 'completed', 'cancelled'));


-- 스마트 오더 주문서
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null references queues(id) on delete cascade,
  customer_name text not null,
  queue_number integer not null,
  status text not null default 'shopping'
    check (status in ('shopping', 'pending', 'paid', 'cancelled', 'completed')),
  total_price numeric not null default 0,
  created_at timestamptz not null default now()
);

-- 기존 DB: alter table public.orders add column if not exists total_price numeric not null default 0;

-- 기존 DB: shopping 상태 허용 (1회 실행)
-- alter table orders drop constraint if exists orders_status_check;
-- alter table orders add constraint orders_status_check
--   check (status in ('shopping', 'pending', 'paid', 'cancelled', 'completed'));
-- alter table orders alter column status set default 'shopping';

-- 기존 orders에 컬럼이 없다면 실행
-- alter table orders add column if not exists customer_name text;
-- alter table orders add column if not exists queue_number integer;

create index if not exists orders_status_idx on orders (status);
create index if not exists orders_queue_id_idx on orders (queue_id);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity integer not null check (quantity > 0),
  product_name text,
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on order_items (order_id);
create index if not exists order_items_product_id_idx on order_items (product_id);

-- Realtime: DELETE/UPDATE 시 old row 전체 필드 + 필터(id=eq.…)가 동작하도록
alter table inventory replica identity full;
alter table sales_logs replica identity full;
alter table orders replica identity full;
alter table order_items replica identity full;
alter table queues replica identity full;

-- Publications (이미 있으면 무시)
do $$
begin
  begin
    alter publication supabase_realtime add table inventory;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table sales_logs;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table orders;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table order_items;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table queues;
  exception when duplicate_object then null;
  end;
end $$;
