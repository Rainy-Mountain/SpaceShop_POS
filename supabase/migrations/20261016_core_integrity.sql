-- Existing installations: apply once to the sck schema before deploying the app.
-- Fresh installations: run schema.sql first, then this migration.
begin;

alter table sck.sales_logs add column if not exists voided_at timestamptz;
alter table sck.sales_logs add column if not exists request_hash text;
alter table sck.movement_logs add column if not exists reversed_at timestamptz;
alter table sck.queues add column if not exists client_token uuid;

create index if not exists sales_logs_payment_group_idx on sck.sales_logs(payment_group_id);
create unique index if not exists queues_active_client_unique on sck.queues(client_token)
  where client_token is not null and status not in ('completed', 'cancelled');
-- Fails rather than silently renumbering existing duplicate queue numbers.
create unique index if not exists queues_number_unique on sck.queues(queue_number);
create sequence if not exists sck.queue_number_seq;
lock table sck.queues in exclusive mode;
select setval('sck.queue_number_seq', greatest(coalesce(max(queue_number), 0) + 1, 1), false)
from sck.queues;

-- Removing a product must never erase historical revenue.
do $$
declare constraint_name text;
begin
  for constraint_name in
    select c.conname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'sck.sales_logs'::regclass and c.contype = 'f'
      and c.confrelid = 'sck.products'::regclass and a.attname = 'product_id'
  loop
    execute format('alter table sck.sales_logs drop constraint %I', constraint_name);
  end loop;
end $$;
alter table sck.sales_logs add constraint sales_logs_product_id_fkey
  foreign key (product_id) references sck.products(id) on delete restrict;

-- SECURITY INVOKER: existing table privileges and RLS still apply.
-- No SECURITY DEFINER or unrestricted table grants are introduced here.
create or replace function sck.complete_sale(
  p_payment_id uuid, p_day_number integer, p_items jsonb, p_order_id uuid default null
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_order sck.orders%rowtype;
  v_queue sck.queues%rowtype;
  v_inventory sck.inventory%rowtype;
  v_product sck.products%rowtype;
  v_item record;
  v_items jsonb;
  v_hash text;
  v_existing_hash text;
  v_voided boolean;
  v_total numeric := 0;
  v_available integer;
begin
  if p_payment_id is null or p_day_number not between 1 and 3 or p_day_number is null then
    raise exception '결제 식별자와 행사 일차를 확인해 주세요.';
  end if;
  v_hash := md5(jsonb_build_object('order', p_order_id, 'day', p_day_number, 'items', p_items)::text);
  -- Serialize retries of one request, including retries after a lost response.
  perform pg_advisory_xact_lock(hashtextextended(p_payment_id::text, 0));
  select min(request_hash), bool_or(voided_at is not null)
    into v_existing_hash, v_voided from sck.sales_logs where payment_group_id = p_payment_id;
  if found and v_existing_hash is not null then
    if v_existing_hash <> v_hash then raise exception '같은 결제 ID에 다른 내용이 전달됐습니다.'; end if;
    if v_voided then raise exception '이미 취소된 결제입니다. 새 결제로 진행해 주세요.'; end if;
    return p_payment_id;
  end if;
  if exists(select 1 from sck.sales_logs where payment_group_id = p_payment_id) then
    raise exception '이미 사용된 결제 ID입니다.';
  end if;

  if p_order_id is not null then
    select * into v_order from sck.orders where id = p_order_id for update;
    if not found or v_order.status <> 'pending' then raise exception '결제 대기 주문이 아닙니다.'; end if;
    select * into v_queue from sck.queues where id = v_order.queue_id;
    if not found then raise exception '주문에 연결된 대기열을 찾을 수 없습니다.'; end if;
  end if;
  v_items := p_items;
  if v_items is null and p_order_id is not null then
    select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity,
      'sold_from', '창고', 'unit_price', null) order by product_id)
      into v_items from sck.order_items where order_id = p_order_id;
  end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' then raise exception '결제할 상품이 없습니다.'; end if;
  if jsonb_array_length(v_items) = 0 then raise exception '결제할 상품이 없습니다.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(v_items) as x(product_id uuid, quantity numeric, sold_from text, unit_price numeric)
    where product_id is null or quantity is null or quantity <= 0 or quantity <> trunc(quantity)
      or quantity > 2147483647 or sold_from is null or sold_from not in ('차량', '창고', '진열')
      or (unit_price is not null and (unit_price < 0 or unit_price = 'NaN'::numeric))
      or (p_order_id is not null and sold_from <> '창고')
  ) then raise exception '상품, 수량, 가격, 재고 위치를 확인해 주세요.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(v_items) as x(product_id uuid, sold_from text, unit_price numeric)
    group by product_id, sold_from having count(distinct unit_price) > 1
  ) then raise exception '동일 상품의 가격이 서로 다릅니다.'; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity,
    'sold_from', sold_from, 'unit_price', unit_price) order by product_id, sold_from)
    into v_items from (
      select product_id, sum(quantity) quantity, sold_from, min(unit_price) unit_price
      from jsonb_to_recordset(v_items) as x(product_id uuid, quantity numeric, sold_from text, unit_price numeric)
      group by product_id, sold_from
    ) grouped;

  -- All product/inventory rows are locked in one stable order to avoid lost updates
  -- and opposite lock orders when several tills sell overlapping baskets.
  perform p.id from sck.products p where p.id in (
    select product_id from jsonb_to_recordset(v_items) as x(product_id uuid)
  ) order by p.id for share of p;
  perform i.product_id from sck.inventory i where i.product_id in (
    select product_id from jsonb_to_recordset(v_items) as x(product_id uuid)
  ) order by i.product_id for update of i;

  for v_item in select * from jsonb_to_recordset(v_items)
    as x(product_id uuid, quantity integer, sold_from text, unit_price numeric)
  loop
    select * into v_product from sck.products where id = v_item.product_id;
    if not found then raise exception '상품을 찾을 수 없습니다.'; end if;
    if v_product.price is null or v_product.price < 0 or
      v_product.price in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      then raise exception '상품 가격을 확인해 주세요.'; end if;
    if v_item.unit_price is not null and v_item.unit_price <> v_product.price then
      raise exception '상품 가격이 변경되었습니다. 새로고침 후 다시 확인해 주세요.';
    end if;
    select * into v_inventory from sck.inventory where product_id = v_item.product_id;
    if not found then raise exception '상품 재고를 찾을 수 없습니다.'; end if;
    v_available := case v_item.sold_from when '차량' then v_inventory.backup_qty
      when '창고' then v_inventory.storage_qty else v_inventory.display_qty end;
    if v_available is null or v_available < v_item.quantity then
      raise exception '% 재고가 부족합니다. (현재 %개)', v_product.name, coalesce(v_available, 0);
    end if;
    v_total := v_total + v_product.price * v_item.quantity;
  end loop;

  if p_order_id is not null then
    delete from sck.order_items where order_id = p_order_id;
    if exists(select 1 from sck.order_items where order_id = p_order_id) then
      raise exception '기존 주문 품목을 변경할 권한이 없습니다.';
    end if;
    insert into sck.order_items(order_id, product_id, quantity, product_name)
      select p_order_id, x.product_id, x.quantity, p.name
      from jsonb_to_recordset(v_items) as x(product_id uuid, quantity integer)
      join sck.products p on p.id = x.product_id;
  end if;
  for v_item in select * from jsonb_to_recordset(v_items)
    as x(product_id uuid, quantity integer, sold_from text)
  loop
    update sck.inventory set
      backup_qty = backup_qty - case when v_item.sold_from = '차량' then v_item.quantity else 0 end,
      storage_qty = storage_qty - case when v_item.sold_from = '창고' then v_item.quantity else 0 end,
      display_qty = display_qty - case when v_item.sold_from = '진열' then v_item.quantity else 0 end,
      last_updated = now() where product_id = v_item.product_id;
    if not found then raise exception '재고를 변경할 권한이 없습니다.'; end if;
    insert into sck.sales_logs(product_id, day_number, sold_from, quantity, total_price,
      payment_group_id, order_id, queue_id, guest_customer_name, guest_queue_number, request_hash)
      select p.id, p_day_number, v_item.sold_from, v_item.quantity, p.price * v_item.quantity,
        p_payment_id, p_order_id, v_order.queue_id, v_queue.customer_name, v_queue.queue_number, v_hash
      from sck.products p where p.id = v_item.product_id;
    if not found then raise exception '매출을 기록할 상품을 찾을 수 없습니다.'; end if;
  end loop;
  if p_order_id is not null then
    update sck.orders set status = 'paid', total_price = v_total,
      customer_name = v_queue.customer_name, queue_number = v_queue.queue_number
      where id = p_order_id and status = 'pending';
    if not found then raise exception '주문 상태를 변경하지 못했습니다.'; end if;
    update sck.queues set status = 'completed' where id = v_order.queue_id;
    if not found then raise exception '대기열 상태를 변경하지 못했습니다.'; end if;
  end if;
  return p_payment_id;
end $$;

-- Keep voided logs as idempotency tombstones; never erase payment history.
create or replace function sck.void_sales(p_sale_ids uuid[])
returns void language plpgsql security invoker set search_path = '' as $$
declare v_sale record;
begin
  if p_sale_ids is null or cardinality(p_sale_ids) = 0 then raise exception '취소할 판매 내역이 없습니다.'; end if;
  perform id from sck.sales_logs where id = any(p_sale_ids) order by id for update;
  if (select count(*) from sck.sales_logs where id = any(p_sale_ids)) <
    (select count(distinct id) from unnest(p_sale_ids) id) then
    raise exception '취소할 판매 기록을 찾을 수 없거나 접근 권한이 없습니다.';
  end if;
  perform i.product_id from sck.inventory i where i.product_id in (
    select product_id from sck.sales_logs where id = any(p_sale_ids) and voided_at is null
  ) order by i.product_id for update of i;
  for v_sale in select * from sck.sales_logs where id = any(p_sale_ids) and voided_at is null order by id
  loop
    update sck.inventory set
      backup_qty = backup_qty + case when v_sale.sold_from = '차량' then v_sale.quantity else 0 end,
      storage_qty = storage_qty + case when v_sale.sold_from = '창고' then v_sale.quantity else 0 end,
      display_qty = display_qty + case when v_sale.sold_from = '진열' then v_sale.quantity else 0 end,
      last_updated = now() where product_id = v_sale.product_id;
    if not found then raise exception '복구할 재고를 찾을 수 없거나 권한이 없습니다.'; end if;
    update sck.sales_logs set voided_at = now() where id = v_sale.id;
    if not found then raise exception '판매 취소 권한이 없습니다.'; end if;
  end loop;
end $$;

create or replace function sck.move_stock(p_product_id uuid, p_from text, p_to text, p_quantity integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_inventory sck.inventory%rowtype; v_available integer;
begin
  if p_quantity is null or p_quantity <= 0 or p_from is null or p_to is null or p_from = p_to
    or p_from not in ('차량', '창고', '진열') or p_to not in ('차량', '창고', '진열') then
    raise exception '재고 위치와 이동 수량을 확인해 주세요.';
  end if;
  select * into v_inventory from sck.inventory where product_id = p_product_id for update;
  if not found then raise exception '재고를 찾을 수 없습니다.'; end if;
  v_available := case p_from when '차량' then v_inventory.backup_qty
    when '창고' then v_inventory.storage_qty else v_inventory.display_qty end;
  if coalesce(v_available, 0) < p_quantity then raise exception '이동할 재고가 부족합니다.'; end if;
  update sck.inventory set
    backup_qty = backup_qty + (case when p_to = '차량' then p_quantity else 0 end) - (case when p_from = '차량' then p_quantity else 0 end),
    storage_qty = storage_qty + (case when p_to = '창고' then p_quantity else 0 end) - (case when p_from = '창고' then p_quantity else 0 end),
    display_qty = display_qty + (case when p_to = '진열' then p_quantity else 0 end) - (case when p_from = '진열' then p_quantity else 0 end),
    last_updated = now() where product_id = p_product_id;
  if not found then raise exception '재고 변경 권한이 없습니다.'; end if;
  insert into sck.movement_logs(product_id, from_location, to_location, quantity)
    values(p_product_id, p_from, p_to, p_quantity);
end $$;

create or replace function sck.undo_movement(p_movement_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_move sck.movement_logs%rowtype;
begin
  select * into v_move from sck.movement_logs where id = p_movement_id for update;
  if not found then raise exception '취소할 이동 기록이 없습니다.'; end if;
  if v_move.reversed_at is not null then return; end if;
  -- Implement directly so undo does not create an extra visible movement.
  perform product_id from sck.inventory where product_id = v_move.product_id for update;
  update sck.inventory set
    backup_qty = backup_qty + (case when v_move.from_location = '차량' then v_move.quantity else 0 end) - (case when v_move.to_location = '차량' then v_move.quantity else 0 end),
    storage_qty = storage_qty + (case when v_move.from_location = '창고' then v_move.quantity else 0 end) - (case when v_move.to_location = '창고' then v_move.quantity else 0 end),
    display_qty = display_qty + (case when v_move.from_location = '진열' then v_move.quantity else 0 end) - (case when v_move.to_location = '진열' then v_move.quantity else 0 end),
    last_updated = now()
    where product_id = v_move.product_id and
      case v_move.to_location when '차량' then backup_qty when '창고' then storage_qty else display_qty end >= v_move.quantity;
  if not found then raise exception '이동 취소에 필요한 재고가 부족하거나 권한이 없습니다.'; end if;
  update sck.movement_logs set reversed_at = now() where id = p_movement_id;
  if not found then raise exception '이동 취소 권한이 없습니다.'; end if;
end $$;

create or replace function sck.add_inventory(p_product_id uuid, p_backup integer, p_storage integer)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_backup is null or p_storage is null or p_backup < 0 or p_storage < 0 then raise exception '입고 수량을 확인해 주세요.'; end if;
  insert into sck.inventory as i(product_id, backup_qty, storage_qty, display_qty, last_updated)
    values(p_product_id, p_backup, p_storage, 0, now())
    on conflict(product_id) do update set backup_qty = i.backup_qty + excluded.backup_qty,
      storage_qty = i.storage_qty + excluded.storage_qty, last_updated = now();
end $$;

create or replace function sck.register_queue(p_phone_tail text, p_client_token uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_auto_enter boolean; v_number integer;
begin
  if p_phone_tail is null or p_phone_tail !~ '^[0-9]{4}$' or p_client_token is null then
    raise exception '번호 뒷자리와 고객 식별자를 확인해 주세요.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_token::text, 1));
  select id into v_id from sck.queues where client_token = p_client_token
    and customer_name = p_phone_tail and status not in ('completed', 'cancelled');
  if found then return v_id; end if;
  perform pg_advisory_xact_lock(hashtextextended('spaceshop:queue-number', 0));
  -- Manual staff numbering may be ahead of the sequence. Reconcile while holding
  -- the same allocation lock; do not grant callers sequence UPDATE privileges.
  select greatest(nextval('sck.queue_number_seq'), coalesce(max(queue_number), 0) + 1)
    into v_number from sck.queues;
  select coalesce(auto_enter, false) into v_auto_enter from sck.store_settings where id = 1;
  insert into sck.queues(queue_number, customer_name, status, client_token)
    values(v_number, p_phone_tail,
      case when v_auto_enter then 'entered' else 'waiting' end, p_client_token)
    returning id into v_id;
  return v_id;
end $$;

create or replace function sck.set_queue_number(p_queue_id uuid, p_queue_number integer)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_queue_number is null or p_queue_number < 1 then raise exception '1 이상의 순번을 입력해 주세요.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('spaceshop:queue-number', 0));
  update sck.queues set queue_number = p_queue_number where id = p_queue_id;
  if not found then raise exception '대기열을 변경할 권한이 없습니다.'; end if;
end $$;

-- Functions do not bypass RLS; grant only entry points, not extra table access.
revoke all on function sck.complete_sale(uuid, integer, jsonb, uuid) from public;
revoke all on function sck.void_sales(uuid[]) from public;
revoke all on function sck.move_stock(uuid, text, text, integer) from public;
revoke all on function sck.undo_movement(uuid) from public;
revoke all on function sck.add_inventory(uuid, integer, integer) from public;
revoke all on function sck.register_queue(text, uuid) from public;
revoke all on function sck.set_queue_number(uuid, integer) from public;
do $$
declare role_name text;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    if exists(select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function sck.complete_sale(uuid, integer, jsonb, uuid), sck.void_sales(uuid[]), sck.move_stock(uuid, text, text, integer), sck.undo_movement(uuid), sck.add_inventory(uuid, integer, integer), sck.register_queue(text, uuid), sck.set_queue_number(uuid, integer) to %I', role_name);
      execute format('grant usage on sequence sck.queue_number_seq to %I', role_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
