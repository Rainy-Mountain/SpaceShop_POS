import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { fetchAllRows, fetchIdBatches } from "../src/lib/fetchAllRows";
import { countPayments, paymentKey } from "../src/lib/paymentIdentity";
import { normalizeSaleItems, paymentAttempt, savedPaymentAttempt } from "../src/lib/paymentActions";

const db = new PGlite();
const p1 = "00000000-0000-4000-8000-000000000001";
const p2 = "00000000-0000-4000-8000-000000000002";
const queue = "00000000-0000-4000-8000-000000000003";
const order = "00000000-0000-4000-8000-000000000004";
const payment = "00000000-0000-4000-8000-000000000005";
const items = (quantity = 1) => normalizeSaleItems([
  { productId: p1, quantity, unitPrice: 1000, soldFrom: "창고" },
]);
async function sale(id = payment, cart: unknown = items(), orderId: string | null = null) {
  return db.query("select sck.complete_sale($1::uuid, 1, $2::jsonb, $3::uuid) as id", [
    id, cart == null ? null : JSON.stringify(cart), orderId,
  ]);
}
async function stock(id = p1) {
  return (await db.query<{ storage_qty: number }>("select storage_qty from sck.inventory where product_id = $1", [id])).rows[0].storage_qty;
}
async function seedOrder() {
  await db.query("insert into sck.queues(id, queue_number, customer_name, status) values($1, 99, '1234', 'entered')", [queue]);
  await db.query("insert into sck.orders(id, queue_id, customer_name, queue_number, status) values($1, $2, '1234', 99, 'pending')", [order, queue]);
  await db.query("insert into sck.order_items(order_id, product_id, quantity, product_name) values($1, $2, 1, 'Sample A')", [order, p1]);
}

before(async () => {
  await db.exec("create publication supabase_realtime; create role core_test_denied; create role anon; create role authenticated;");
  await db.exec(await readFile("supabase/schema.sql", "utf8"));
  const migration = await readFile("supabase/migrations/20261016_core_integrity.sql", "utf8");
  await db.exec(migration);
  // Reapplying must not destroy data or fail on existing schema objects.
  await db.exec(migration);
});
after(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec("truncate sck.products, sck.queues cascade; select setval('sck.queue_number_seq', 1, false);");
  await db.query("insert into sck.products(id, name, price) values($1, 'Sample A', 1000), ($2, 'Sample B', 2000)", [p1, p2]);
  await db.query("insert into sck.inventory(product_id, storage_qty, backup_qty, display_qty) values($1, 2, 0, 0), ($2, 4, 0, 0)", [p1, p2]);
});

test("같은 초의 다른 결제는 두 건, 같은 결제의 여러 품목은 한 건", () => {
  const logs = [
    { id: "1", paymentGroupId: "a", createdAt: "2026-10-16T00:00:00Z" },
    { id: "2", paymentGroupId: "b", createdAt: "2026-10-16T00:00:00Z" },
    { id: "3", paymentGroupId: "a", createdAt: "2026-10-16T00:00:01Z" },
  ];
  assert.equal(countPayments(logs), 2);
  assert.equal(paymentKey({ id: "x", orderId: "o" }), "ord:o");
  assert.equal(countPayments([{ id: "legacy-1" }, { id: "legacy-2" }]), 2);
});

test("1,001행과 서버의 더 작은 행 제한을 모두 조회", async () => {
  const source = Array.from({ length: 1001 }, (_, id) => ({ id }));
  const rows = await fetchAllRows(async (from, to) => ({
    data: source.slice(from, Math.min(to + 1, from + 137)), error: null,
  }));
  assert.deepEqual(rows, source);
});

test("페이지 오류는 0원 매출로 숨기지 않고 전달", async () => {
  await assert.rejects(fetchAllRows(async () => ({ data: null, error: { message: "network failed" } })), /network failed/);
});

test("관련 주문 ID도 URL 길이를 제한해 빠짐없이 조회", async () => {
  const ids = Array.from({ length: 1101 }, (_, i) => String(i));
  const sizes: number[] = [];
  const rows = await fetchIdBatches([...ids, "0"], async (batch) => {
    sizes.push(batch.length);
    return { data: batch, error: null };
  });
  assert.deepEqual(rows, ids);
  assert.ok(sizes.every((n) => n <= 100));
});

test("재시도는 같은 결제 ID, 내용이 바뀌면 다른 결제 ID", () => {
  const first = paymentAttempt(null, "cart-a", () => "id-a");
  assert.equal(paymentAttempt(first, "cart-a", () => "wrong"), first);
  assert.equal(paymentAttempt(first, "cart-b", () => "id-b").id, "id-b");
  assert.throws(() => normalizeSaleItems([{ productId: p1, quantity: 1.5, soldFrom: "창고" }]), /수량/);
});

test("응답 유실 후 재로딩해도 저장한 요청 ID로 재확인", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const first = savedPaymentAttempt(storage, "test", "cart-a");
  assert.equal(savedPaymentAttempt(storage, "test", "cart-a").id, first.id);
  assert.notEqual(savedPaymentAttempt(storage, "test", "cart-b").id, first.id);
});

test("스마트 주문 결제와 중복 재시도는 재고·매출에 한 번만 반영", async () => {
  await seedOrder();
  await sale(order, items(), order);
  await sale(order, items(), order);
  assert.equal(await stock(), 1);
  assert.equal((await db.query("select * from sck.sales_logs")).rows.length, 1);
  assert.equal((await db.query<{ status: string }>("select status from sck.orders where id = $1", [order])).rows[0].status, "paid");
  assert.equal((await db.query<{ status: string }>("select status from sck.queues where id = $1", [queue])).rows[0].status, "completed");
});

test("마이그레이션 재적용은 기존 판매 기록과 재고를 보존", async () => {
  await sale();
  await db.exec(await readFile("supabase/migrations/20261016_core_integrity.sql", "utf8"));
  assert.equal(await stock(), 1);
  assert.equal((await db.query("select * from sck.sales_logs")).rows.length, 1);
  await sale();
  assert.equal(await stock(), 1);
});

test("매출 INSERT 실패는 재고·주문·대기열까지 전부 롤백", async () => {
  await seedOrder();
  await db.exec(`create function sck.test_fail() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end $$;
    create trigger test_failure before insert on sck.sales_logs for each row execute function sck.test_fail();`);
  try { await assert.rejects(sale(order, items(), order), /simulated failure/); }
  finally { await db.exec("drop trigger test_failure on sck.sales_logs; drop function sck.test_fail();"); }
  assert.equal(await stock(), 2);
  assert.equal((await db.query<{ status: string }>("select status from sck.orders where id = $1", [order])).rows[0].status, "pending");
  assert.equal((await db.query<{ status: string }>("select status from sck.queues where id = $1", [queue])).rows[0].status, "entered");
  assert.equal((await db.query("select * from sck.sales_logs")).rows.length, 0);
  await sale(order, items(), order);
  assert.equal(await stock(), 1);
});

test("여러 품목 중 하나라도 부족하면 아무 상품도 판매하지 않음", async () => {
  await assert.rejects(sale(payment, [...items(), { product_id: p2, quantity: 5, sold_from: "창고", unit_price: 2000 }]), /부족/);
  assert.equal(await stock(), 2);
  assert.equal(await stock(p2), 4);
  assert.equal((await db.query("select * from sck.sales_logs")).rows.length, 0);
});

test("재고 2개에 결제 세 요청: 두 건만 성공하고 재고는 0", async () => {
  // PGlite serializes connections. This verifies server-side atomic execution;
  // multi-connection lock waiting is a separate real-Postgres integration check.
  const results = await Promise.allSettled([1, 2, 3].map((n) => sale(`10000000-0000-4000-8000-${String(n).padStart(12, "0")}`)));
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
  assert.equal(await stock(), 0);
  assert.equal((await db.query("select * from sck.sales_logs")).rows.length, 2);
});

test("같은 결제 ID의 다른 요청과 조작한 가격은 거부", async () => {
  await sale();
  await assert.rejects(sale(payment, items(2)), /다른 내용/);
  await assert.rejects(sale(crypto.randomUUID(), [{ ...items()[0], unit_price: 1 }]), /가격이 변경/);
  assert.equal(await stock(), 1);
});

test("판매 취소 재시도는 재고를 한 번만 복구하고 결제 재생을 막음", async () => {
  await sale();
  const ids = (await db.query<{ id: string }>("select id from sck.sales_logs")).rows.map((x) => x.id);
  await db.query("select sck.void_sales($1::uuid[])", [ids]);
  await db.query("select sck.void_sales($1::uuid[])", [ids]);
  assert.equal(await stock(), 2);
  assert.equal((await db.query("select * from sck.sales_logs where voided_at is null")).rows.length, 0);
  await assert.rejects(sale(), /취소된 결제/);
});

test("판매 취소 기록 실패 시 재고 복구도 롤백", async () => {
  await sale();
  const ids = (await db.query<{ id: string }>("select id from sck.sales_logs")).rows.map((x) => x.id);
  await db.exec(`create function sck.test_fail() returns trigger language plpgsql as $$ begin raise exception 'refund failed'; end $$;
    create trigger test_failure before update on sck.sales_logs for each row execute function sck.test_fail();`);
  try { await assert.rejects(db.query("select sck.void_sales($1::uuid[])", [ids]), /refund failed/); }
  finally { await db.exec("drop trigger test_failure on sck.sales_logs; drop function sck.test_fail();"); }
  assert.equal(await stock(), 1);
  assert.equal((await db.query("select * from sck.sales_logs where voided_at is null")).rows.length, 1);
});

test("판매 이력이 있는 상품은 삭제해도 매출이 사라지지 않도록 삭제를 거부", async () => {
  await sale();
  await assert.rejects(db.query("delete from sck.products where id = $1", [p1]), /foreign key/);
  assert.equal((await db.query("select * from sck.sales_logs")).rows.length, 1);
});

test("재고 이동과 반복 취소는 수량을 보존", async () => {
  await db.query("select sck.move_stock($1, '창고', '차량', 1)", [p1]);
  assert.equal(await stock(), 1);
  const id = (await db.query<{ id: string }>("select id from sck.movement_logs")).rows[0].id;
  await db.query("select sck.undo_movement($1)", [id]);
  await db.query("select sck.undo_movement($1)", [id]);
  assert.equal(await stock(), 2);
});

test("동일 번호 뒷자리의 다른 손님은 분리, 같은 기기는 이어하기", async () => {
  const token = crypto.randomUUID();
  const a = (await db.query<{ id: string }>("select sck.register_queue('1234', $1) as id", [token])).rows[0].id;
  const resumed = (await db.query<{ id: string }>("select sck.register_queue('1234', $1) as id", [token])).rows[0].id;
  const b = (await db.query<{ id: string }>("select sck.register_queue('1234', $1) as id", [crypto.randomUUID()])).rows[0].id;
  assert.equal(a, resumed);
  assert.notEqual(a, b);
  assert.deepEqual((await db.query<{ queue_number: number }>("select queue_number from sck.queues order by queue_number")).rows.map((x) => x.queue_number), [1, 2]);
});

test("직원의 수동 순번 변경 이후에도 다음 번호가 충돌하지 않음", async () => {
  const a = (await db.query<{ id: string }>("select sck.register_queue('1234', $1) as id", [crypto.randomUUID()])).rows[0].id;
  await db.query("select sck.set_queue_number($1, 100)", [a]);
  await db.query("select sck.register_queue('5678', $1)", [crypto.randomUUID()]);
  assert.deepEqual((await db.query<{ queue_number: number }>("select queue_number from sck.queues order by queue_number")).rows.map((x) => x.queue_number), [100, 101]);
});

test("RPC 호출 권한이 있어도 테이블 접근 권한을 우회하지 않음", async () => {
  await db.exec("grant usage on schema sck to core_test_denied; grant execute on function sck.complete_sale(uuid, integer, jsonb, uuid) to core_test_denied; set role core_test_denied;");
  try { await assert.rejects(sale(), /permission denied/); }
  finally { await db.exec("reset role;"); }
  assert.equal(await stock(), 2);
});
