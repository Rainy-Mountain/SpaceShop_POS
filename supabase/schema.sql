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
  created_at timestamptz not null default now()
);

create table if not exists movement_logs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  from_location text not null check (from_location in ('차량', '창고', '진열')),
  to_location text not null check (to_location in ('차량', '창고', '진열')),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

-- Realtime: DELETE/UPDATE 시 old row 전체 필드가 오도록
alter table inventory replica identity full;
alter table sales_logs replica identity full;

-- Supabase Dashboard > Replication 에서 해당 테이블을 켜거나, 아래를 실행
-- alter publication supabase_realtime add table inventory;
-- alter publication supabase_realtime add table sales_logs;
