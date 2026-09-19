import { supabase } from "@/lib/supabase";
import { readStoredEventDay } from "@/lib/eventDay";
import type { EventDay } from "@/types/dashboard";

export type CartItem = {
  productId: string;
  name: string;
  brand: string;
  qty: number;
  price?: number;
};

/** pending 주문서에 담긴 제품별 대기 수량 합계 */
export async function fetchPendingQtyByProduct(): Promise<Map<string, number>> {
  const { data: pendingOrders, error: ordersError } = await supabase
    .from("orders")
    .select("id")
    .eq("status", "pending");

  if (ordersError) throw ordersError;

  const orderIds = (pendingOrders ?? []).map((row) => row.id as string);
  const map = new Map<string, number>();
  if (orderIds.length === 0) return map;

  const { data: items, error: itemsError } = await supabase
    .from("order_items")
    .select("product_id, quantity")
    .in("order_id", orderIds);

  if (itemsError) throw itemsError;

  for (const item of items ?? []) {
    const productId = String(item.product_id ?? "");
    if (!productId) continue;
    const qty = Number(item.quantity) || 0;
    map.set(productId, (map.get(productId) ?? 0) + qty);
  }

  return map;
}

/**
 * 실제 재고 - pending 대기 수량 - 내 장바구니 수량
 * 담으려는 추가 수량을 반영했을 때 가능한지 검사
 */
export function getAvailableQty(options: {
  storageQty: number;
  pendingQty: number;
  cartQty: number;
}): number {
  return Math.max(
    0,
    options.storageQty - options.pendingQty - options.cartQty
  );
}

export async function submitCustomerOrder(options: {
  queueId: string;
  items: CartItem[];
}): Promise<{ orderId: string }> {
  const { queueId, items } = options;
  if (!queueId) throw new Error("대기열 정보가 없습니다.");
  if (items.length === 0) throw new Error("장바구니가 비어 있습니다.");

  // 1) queues에서 손님 정보 조회 (orders NOT NULL 컬럼용)
  const { data: queue, error: queueError } = await supabase
    .from("queues")
    .select("customer_name, queue_number")
    .eq("id", queueId)
    .maybeSingle();

  if (queueError) {
    console.error("[submitCustomerOrder] queues select 실패", queueError);
    throw queueError;
  }
  if (!queue) {
    throw new Error("대기열을 찾을 수 없습니다. QR로 다시 입장해 주세요.");
  }

  const customerName = String(queue.customer_name ?? "").trim();
  const queueNumber = Number(queue.queue_number);
  if (!customerName) {
    throw new Error("손님 성함 정보가 없습니다.");
  }
  if (!Number.isFinite(queueNumber)) {
    throw new Error("순번 정보가 올바르지 않습니다.");
  }

  // 2) orders INSERT (queue_id + customer_name + queue_number)
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      queue_id: queueId,
      customer_name: customerName,
      queue_number: queueNumber,
      status: "pending",
    })
    .select("id")
    .single();

  if (orderError) {
    console.error("[submitCustomerOrder] orders insert 실패", orderError);
    throw orderError;
  }
  if (!order?.id) throw new Error("주문서 생성에 실패했습니다.");

  const payload = items.map((item) => ({
    order_id: order.id,
    product_id: item.productId,
    quantity: item.qty,
    product_name: item.name,
  }));

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(payload);

  if (itemsError) {
    console.error("[submitCustomerOrder] order_items insert 실패", itemsError);
    await supabase.from("orders").delete().eq("id", order.id);
    throw itemsError;
  }

  return { orderId: order.id as string };
}

export type PendingPosOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
};

export type PendingPosOrder = {
  id: string;
  queueId: string;
  queueNumber: number;
  customerName: string;
  createdAt: string;
  items: PendingPosOrderItem[];
};

function normalizeQueueRelation(
  queues: unknown
): { queue_number?: number; customer_name?: string } | null {
  if (!queues) return null;
  if (Array.isArray(queues)) {
    return (queues[0] as { queue_number?: number; customer_name?: string }) ?? null;
  }
  return queues as { queue_number?: number; customer_name?: string };
}

/** pending 주문 + 순번/성함/품목 (클라이언트에서 queue_number 오름차순 정렬) */
export async function fetchPendingPosOrders(): Promise<PendingPosOrder[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      queue_id,
      created_at,
      customer_name,
      queue_number,
      queues ( queue_number, customer_name ),
      order_items ( id, product_id, quantity, product_name )
    `
    )
    .eq("status", "pending");

  if (error) throw error;

  const rows: PendingPosOrder[] = (data ?? []).map((row) => {
    const queue = normalizeQueueRelation(row.queues);
    const itemsRaw = Array.isArray(row.order_items) ? row.order_items : [];
    const queueNumber =
      Number(row.queue_number) || Number(queue?.queue_number) || 0;
    const customerName =
      String(row.customer_name ?? "").trim() ||
      String(queue?.customer_name ?? "손님");

    return {
      id: String(row.id),
      queueId: String(row.queue_id),
      queueNumber,
      customerName,
      createdAt: String(row.created_at ?? ""),
      items: itemsRaw.map((item) => ({
        id: String(item.id),
        productId: String(item.product_id),
        productName: String(item.product_name ?? "제품"),
        quantity: Number(item.quantity) || 0,
      })),
    };
  });

  return rows.sort((a, b) => a.queueNumber - b.queueNumber);
}

export type KioskCartItem = {
  id: string;
  name: string;
  brand: string;
  price: number;
  qty: number;
  maxQty: number;
};

/**
 * 키오스크 장바구니용 — order_items + products/inventory를 분리 조회로 매핑.
 * (중첩 join이 PostgREST 관계/권한으로 실패하는 경우 방지)
 */
export async function loadSmartOrderForKiosk(orderId: string): Promise<{
  order: PendingPosOrder;
  cartItems: KioskCartItem[];
}> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
      id,
      queue_id,
      status,
      customer_name,
      queue_number,
      created_at,
      queues ( queue_number, customer_name ),
      order_items ( id, product_id, quantity, product_name )
    `
    )
    .eq("id", orderId)
    .single();

  if (error) {
    console.error("[loadSmartOrderForKiosk] 주문 조회 실패", error);
    throw new Error(error.message || "주문 조회에 실패했습니다.");
  }
  if (!data) throw new Error("주문을 찾을 수 없습니다.");
  if (data.status !== "pending") {
    throw new Error("이미 처리된 주문이거나 대기 중이 아닙니다.");
  }

  const queue = normalizeQueueRelation(data.queues);
  const itemsRaw = Array.isArray(data.order_items) ? data.order_items : [];
  if (itemsRaw.length === 0) {
    throw new Error("주문 품목이 비어 있습니다.");
  }

  const productIds = [
    ...new Set(
      itemsRaw
        .map((item) => String(item.product_id ?? "").trim())
        .filter(Boolean)
    ),
  ];

  if (productIds.length === 0) {
    throw new Error("주문 품목에 유효한 product_id가 없습니다.");
  }

  const [{ data: productRows, error: productsError }, { data: inventoryRows, error: inventoryError }] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, name, brand, price")
        .in("id", productIds),
      supabase
        .from("inventory")
        .select("product_id, storage_qty")
        .in("product_id", productIds),
    ]);

  if (productsError) {
    console.error("[loadSmartOrderForKiosk] products 조회 실패", productsError);
    throw new Error(productsError.message || "제품 정보 조회에 실패했습니다.");
  }
  if (inventoryError) {
    console.error(
      "[loadSmartOrderForKiosk] inventory 조회 실패",
      inventoryError
    );
    throw new Error(
      inventoryError.message || "재고 정보 조회에 실패했습니다."
    );
  }

  const productById = new Map(
    (productRows ?? []).map((row) => [
      String(row.id),
      {
        id: String(row.id),
        name: String(row.name ?? "제품"),
        brand: String(row.brand ?? ""),
        price: Number(row.price) || 0,
      },
    ])
  );

  const storageById = new Map(
    (inventoryRows ?? []).map((row) => [
      String(row.product_id),
      Number(row.storage_qty) || 0,
    ])
  );

  // 동일 product_id 수량 합산
  const qtyByProduct = new Map<string, { qty: number; fallbackName: string; itemId: string }>();
  for (const item of itemsRaw) {
    const productId = String(item.product_id ?? "").trim();
    if (!productId) continue;
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) continue;
    const prev = qtyByProduct.get(productId);
    if (prev) {
      prev.qty += qty;
    } else {
      qtyByProduct.set(productId, {
        qty,
        fallbackName: String(item.product_name ?? "").trim(),
        itemId: String(item.id),
      });
    }
  }

  const cartItems: KioskCartItem[] = [];
  const orderItems: PendingPosOrderItem[] = [];

  for (const [productId, entry] of qtyByProduct) {
    const product = productById.get(productId);
    if (!product) {
      console.error(
        "[loadSmartOrderForKiosk] products에 없는 product_id",
        productId,
        entry
      );
      throw new Error(
        `제품 정보를 찾을 수 없습니다 (product_id: ${productId}${
          entry.fallbackName ? `, ${entry.fallbackName}` : ""
        }).`
      );
    }

    const storageQty = storageById.get(productId) ?? 0;
    const qty = entry.qty;
    const maxQty = Math.max(storageQty, qty, 1);

    cartItems.push({
      id: product.id,
      name: product.name || entry.fallbackName || "제품",
      brand: product.brand,
      price: product.price,
      qty: Math.min(qty, maxQty),
      maxQty,
    });

    orderItems.push({
      id: entry.itemId,
      productId: product.id,
      productName: product.name || entry.fallbackName || "제품",
      quantity: qty,
    });
  }

  if (cartItems.length === 0) {
    throw new Error("장바구니로 변환할 수 있는 품목이 없습니다.");
  }

  const order: PendingPosOrder = {
    id: String(data.id),
    queueId: String(data.queue_id),
    queueNumber:
      Number(data.queue_number) || Number(queue?.queue_number) || 0,
    customerName:
      String(data.customer_name ?? "").trim() ||
      String(queue?.customer_name ?? "손님"),
    createdAt: String(data.created_at ?? ""),
    items: orderItems,
  };

  return { order, cartItems };
}

/**
 * 결제 완료:
 * 1) sales_logs INSERT (대시보드 매출/최근 판매 반영)
 * 2) inventory.storage_qty 차감
 * 3) orders → paid, queues → completed
 *
 * 판매 기록·재고 차감을 먼저 처리한 뒤 상태를 바꿔, 실패 시 재시도 가능하게 함.
 */
export async function completePosPayment(
  orderId: string,
  dayNumber?: EventDay
): Promise<void> {
  if (!orderId) throw new Error("주문 ID가 없습니다.");

  const day: EventDay =
    dayNumber ??
    (typeof window !== "undefined" ? readStoredEventDay() : 1);

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select(
      `
      id,
      queue_id,
      status,
      order_items (
        product_id,
        quantity,
        product_name
      )
    `
    )
    .eq("id", orderId)
    .single();

  if (fetchError) {
    console.error("[completePosPayment] 주문 조회 실패", fetchError);
    throw new Error(fetchError.message || "주문 조회에 실패했습니다.");
  }
  if (!order) throw new Error("주문을 찾을 수 없습니다.");
  if (order.status !== "pending") {
    throw new Error("이미 처리된 주문입니다.");
  }

  const items = Array.isArray(order.order_items) ? order.order_items : [];
  if (items.length === 0) {
    throw new Error("주문 품목이 없습니다.");
  }

  const productIds = [
    ...new Set(
      items
        .map((item) => String(item.product_id ?? "").trim())
        .filter(Boolean)
    ),
  ];

  const { data: productRows, error: productsError } = await supabase
    .from("products")
    .select("id, name, price")
    .in("id", productIds);

  if (productsError) {
    console.error("[completePosPayment] products 조회 실패", productsError);
    throw new Error(productsError.message || "제품 정보 조회에 실패했습니다.");
  }

  const productById = new Map(
    (productRows ?? []).map((row) => [
      String(row.id),
      {
        name: String(row.name ?? "제품"),
        price: Number(row.price) || 0,
      },
    ])
  );

  type SalePrep = {
    productId: string;
    quantity: number;
    unitPrice: number;
    productName: string;
  };

  const prepared: SalePrep[] = items.map((item) => {
    const productId = String(item.product_id ?? "");
    const quantity = Number(item.quantity) || 0;
    const product = productById.get(productId);
    const unitPrice = product?.price ?? 0;
    const productName = String(
      item.product_name || product?.name || "제품"
    );

    if (!productId || quantity <= 0) {
      throw new Error(`잘못된 주문 품목: ${productName}`);
    }
    if (!product) {
      throw new Error(`제품 정보를 찾을 수 없습니다 (${productId}).`);
    }

    return { productId, quantity, unitPrice, productName };
  });

  // 1) 판매 기록 일괄 INSERT (sales_logs)
  const saleRows = prepared.map((item) => ({
    product_id: item.productId,
    day_number: day,
    sold_from: "창고" as const,
    quantity: item.quantity,
    total_price: item.unitPrice * item.quantity,
  }));

  const { error: salesError } = await supabase
    .from("sales_logs")
    .insert(saleRows);

  if (salesError) {
    console.error("[completePosPayment] sales_logs insert 실패", salesError);
    throw salesError;
  }

  // 2) 샵 재고(storage_qty) 차감 — 항목별 순차 처리
  try {
    for (const item of prepared) {
      const { data: inv, error: invError } = await supabase
        .from("inventory")
        .select("backup_qty, storage_qty, display_qty")
        .eq("product_id", item.productId)
        .maybeSingle();

      if (invError) throw invError;
      if (!inv) {
        throw new Error(
          `"${item.productName}" 재고 정보를 찾을 수 없습니다.`
        );
      }

      const storageQty = Number(inv.storage_qty) || 0;
      if (storageQty < item.quantity) {
        throw new Error(
          `"${item.productName}" 샵 재고가 부족합니다. (현재 ${storageQty}개 / 필요 ${item.quantity}개)`
        );
      }

      const { error: updateError } = await supabase
        .from("inventory")
        .update({
          storage_qty: storageQty - item.quantity,
          last_updated: new Date().toISOString(),
        })
        .eq("product_id", item.productId);

      if (updateError) throw updateError;
    }
  } catch (err) {
    console.error(
      "[completePosPayment] 재고 차감 실패 — 판매 기록은 저장됐을 수 있음",
      err
    );
    throw err;
  }

  // 3) 주문·대기열 상태 변경 (병렬)
  const [orderResult, queueResult] = await Promise.all([
    supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("id", orderId)
      .eq("status", "pending"),
    supabase
      .from("queues")
      .update({ status: "completed" })
      .eq("id", order.queue_id),
  ]);

  if (orderResult.error) {
    console.error("[completePosPayment] orders 상태 변경 실패", orderResult.error);
    throw orderResult.error;
  }
  if (queueResult.error) {
    console.error("[completePosPayment] queues 상태 변경 실패", queueResult.error);
    throw queueResult.error;
  }
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export const SMART_ORDER_TRUNCATE_HINT =
  "Supabase 대시보드의 SQL Editor에서 'TRUNCATE TABLE queues CASCADE;' 명령어를 실행해 주세요.";

/** 손님 주문 수정 — queue의 pending 주문만 삭제 (order_items CASCADE) */
export async function cancelPendingOrderByQueue(
  queueId: string,
  orderId?: string | null
): Promise<void> {
  if (!queueId) throw new Error("대기열 ID가 없습니다.");

  let query = supabase
    .from("orders")
    .delete()
    .eq("queue_id", queueId)
    .eq("status", "pending");

  if (orderId) {
    query = query.eq("id", orderId);
  }

  const { error } = await query;
  if (error) {
    console.error("[cancelPendingOrderByQueue] 삭제 실패", error);
    throw new Error(error.message || "주문 삭제에 실패했습니다.");
  }
}

/** 대기열 1건 삭제 (orders / order_items CASCADE) */
export async function deleteQueueEntry(queueId: string): Promise<void> {
  if (!queueId) throw new Error("대기열 ID가 없습니다.");

  // 연관 주문 먼저 삭제 (FK 방향에 따라 CASCADE가 없을 수 있음)
  const { error: ordersError } = await supabase
    .from("orders")
    .delete()
    .eq("queue_id", queueId);

  if (ordersError) {
    console.error("[deleteQueueEntry] orders 삭제 실패", ordersError);
    throw ordersError;
  }

  const { error } = await supabase.from("queues").delete().eq("id", queueId);
  if (error) {
    console.error("[deleteQueueEntry] queues 삭제 실패", error);
    throw error;
  }
}

/** 주문 1건 + 연결된 대기열 삭제 */
export async function deleteOrderAndQueue(orderId: string): Promise<void> {
  if (!orderId) throw new Error("주문 ID가 없습니다.");

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("id, queue_id")
    .eq("id", orderId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!order) throw new Error("주문을 찾을 수 없습니다.");

  const { error: orderError } = await supabase
    .from("orders")
    .delete()
    .eq("id", orderId);

  if (orderError) {
    console.error("[deleteOrderAndQueue] orders 삭제 실패", orderError);
    throw orderError;
  }

  if (order.queue_id) {
    const { error: queueError } = await supabase
      .from("queues")
      .delete()
      .eq("id", order.queue_id);

    if (queueError) {
      console.error("[deleteOrderAndQueue] queues 삭제 실패", queueError);
      throw queueError;
    }
  }
}

/**
 * 테스트용 스마트 오더 데이터 전체 삭제
 * (필터 없는 delete는 PostgREST에서 막히므로 neq 조건 사용)
 */
export async function clearAllSmartOrderTestData(): Promise<void> {
  const { error: itemsError } = await supabase
    .from("order_items")
    .delete()
    .neq("id", NIL_UUID);

  if (itemsError) {
    console.error("[clearAllSmartOrderTestData] order_items", itemsError);
    throw new Error(SMART_ORDER_TRUNCATE_HINT);
  }

  const { error: ordersError } = await supabase
    .from("orders")
    .delete()
    .neq("id", NIL_UUID);

  if (ordersError) {
    console.error("[clearAllSmartOrderTestData] orders", ordersError);
    throw new Error(SMART_ORDER_TRUNCATE_HINT);
  }

  const { error: queuesError } = await supabase
    .from("queues")
    .delete()
    .neq("id", NIL_UUID);

  if (queuesError) {
    console.error("[clearAllSmartOrderTestData] queues", queuesError);
    throw new Error(SMART_ORDER_TRUNCATE_HINT);
  }
}


