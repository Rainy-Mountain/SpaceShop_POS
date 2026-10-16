-- 주문 최종 결제 금액 (수기 추가 반영용)
alter table sck.orders
  add column if not exists total_price numeric not null default 0;
