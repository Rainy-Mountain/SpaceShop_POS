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
  // 하위 호환: 즉시 pending 제출 (컨시어지 플로우에서는 syncShoppingCart + sendOrderToPos 사용)
  const { orderId } = await syncShoppingCart(options.queueId, options.items);
  if (!orderId) throw new Error("장바구니가 비어 있습니다.");
  await sendOrderToPos(orderId);
  return { orderId };
}

/**
 * 고객 장바구니 → orders(status=shopping) + order_items 실시간 UPSERT
 * 장바구니가 비면 shopping 주문/품목을 정리한다.
 */
export async function syncShoppingCart(
  queueId: string,
  items: CartItem[]
): Promise<{ orderId: string | null }> {
  if (!queueId) throw new Error("대기열 정보가 없습니다.");

  const { data: queue, error: queueError } = await supabase
    .from("queues")
    .select("customer_name, queue_number")
    .eq("id", queueId)
    .maybeSingle();

  if (queueError) {
    console.error("[syncShoppingCart] queues select 실패", queueError);
    throw new Error(queueError.message || "대기열 조회 실패");
  }
  if (!queue) {
    throw new Error("대기열을 찾을 수 없습니다. QR로 다시 입장해 주세요.");
  }

  const customerName = String(queue.customer_name ?? "").trim() || "손님";
  const queueNumber = Number(queue.queue_number) || 0;

  const { data: existing, error: existingError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("queue_id", queueId)
    .in("status", ["shopping", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    console.error("[syncShoppingCart] orders select 실패", existingError);
    throw new Error(existingError.message || "주문 조회 실패");
  }

  // 이미 포스기로 넘긴(pending) 주문은 고객이 장바구니를 바꾸지 않음
  if (existing?.status === "pending") {
    return { orderId: String(existing.id) };
  }

  const normalized = items
    .filter((item) => item.productId && item.qty > 0)
    .map((item) => ({
      productId: item.productId,
      name: item.name,
      qty: item.qty,
    }));

  if (normalized.length === 0) {
    if (existing?.id) {
      const { error: deleteError } = await supabase
        .from("orders")
        .delete()
        .eq("id", existing.id)
        .eq("status", "shopping");
      if (deleteError) {
        console.error("[syncShoppingCart] 빈 장바구니 주문 삭제 실패", deleteError);
        throw new Error(deleteError.message || "주문 삭제 실패");
      }
    }
    return { orderId: null };
  }

  let orderId = existing?.id ? String(existing.id) : null;

  if (!orderId) {
    const { data: created, error: createError } = await supabase
      .from("orders")
      .insert({
        queue_id: queueId,
        customer_name: customerName,
        queue_number: queueNumber,
        status: "shopping",
      })
      .select("id")
      .single();

    if (createError) {
      console.error("[syncShoppingCart] orders insert 실패", createError);
      throw new Error(createError.message || "주문 생성 실패");
    }
    orderId = String(created.id);
  }

  // 전체 교체 방식 (단순·일관) — 기존 품목 삭제 후 재삽입
  const { error: clearError } = await supabase
    .from("order_items")
    .delete()
    .eq("order_id", orderId);

  if (clearError) {
    console.error("[syncShoppingCart] order_items clear 실패", clearError);
    throw new Error(clearError.message || "품목 동기화 실패");
  }

  const { error: insertError } = await supabase.from("order_items").insert(
    normalized.map((item) => ({
      order_id: orderId,
      product_id: item.productId,
      quantity: item.qty,
      product_name: item.name,
    }))
  );

  if (insertError) {
    console.error("[syncShoppingCart] order_items insert 실패", insertError);
    throw new Error(insertError.message || "품목 저장 실패");
  }

  return { orderId };
}

/** 직원이 입장 승인: queues waiting → entered */
export async function admitQueueEntry(queueId: string): Promise<void> {
  if (!queueId) throw new Error("대기열 ID가 없습니다.");

  const { data, error } = await supabase
    .from("queues")
    .update({ status: "entered" })
    .eq("id", queueId)
    .eq("status", "waiting")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[admitQueueEntry] 실패", error);
    throw new Error(error.message || "입장 승인에 실패했습니다.");
  }
  if (!data) {
    throw new Error("입장 대기 손님을 찾을 수 없거나 이미 입장했습니다.");
  }
}

/** 직원이 포스기로 넘기기: shopping → pending */
export async function sendOrderToPos(orderId: string): Promise<void> {
  if (!orderId) throw new Error("주문 ID가 없습니다.");

  const { data, error } = await supabase
    .from("orders")
    .update({ status: "pending" })
    .eq("id", orderId)
    .eq("status", "shopping")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[sendOrderToPos] 실패", error);
    throw new Error(error.message || "포스기 전송에 실패했습니다.");
  }
  if (!data) {
    throw new Error("쇼핑 중 주문을 찾을 수 없거나 이미 전송되었습니다.");
  }
}

/** pending → shopping 복귀 (고객 주문 수정) */
export async function revertOrderToShopping(orderId: string): Promise<void> {
  if (!orderId) throw new Error("주문 ID가 없습니다.");

  const { data, error } = await supabase
    .from("orders")
    .update({ status: "shopping" })
    .eq("id", orderId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[revertOrderToShopping] 실패", error);
    throw new Error(error.message || "주문 수정 모드 전환에 실패했습니다.");
  }
  if (!data) {
    throw new Error("결제 대기 주문을 찾을 수 없습니다.");
  }
}

/** 대기열의 활성 주문(shopping | pending) + 품목 로드 (이어하기/새로고침 복구용) */
export async function loadActiveOrderForQueue(queueId: string): Promise<{
  orderId: string;
  status: string;
  items: CartItem[];
} | null> {
  if (!queueId) return null;

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("queue_id", queueId)
    .in("status", ["shopping", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError) {
    console.error("[loadActiveOrderForQueue] orders 실패", orderError);
    throw new Error(orderError.message || "주문 조회 실패");
  }
  if (!order?.id) return null;

  const orderId = String(order.id);
  const { data: itemsRaw, error: itemsError } = await supabase
    .from("order_items")
    .select("product_id, quantity, product_name")
    .eq("order_id", orderId);

  if (itemsError) {
    console.error("[loadActiveOrderForQueue] order_items 실패", itemsError);
    throw new Error(itemsError.message || "품목 조회 실패");
  }

  const items: CartItem[] = (itemsRaw ?? []).map((item) => ({
    productId: String(item.product_id),
    name: String(item.product_name ?? "제품"),
    brand: "",
    qty: Number(item.quantity) || 0,
  }));

  return {
    orderId,
    status: String(order.status),
    items: items.filter((item) => item.qty > 0),
  };
}

/** 해당 대기열에 결제 완료(paid) 주문이 있는지 */
export async function hasPaidOrderForQueue(queueId: string): Promise<boolean> {
  if (!queueId) return false;
  const { data, error } = await supabase
    .from("orders")
    .select("id")
    .eq("queue_id", queueId)
    .eq("status", "paid")
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[hasPaidOrderForQueue] 실패", error);
    return false;
  }
  return Boolean(data?.id);
}

/** 직원이 순번 강제 변경 */
export async function updateQueueNumber(
  queueId: string,
  queueNumber: number
): Promise<void> {
  if (!queueId) throw new Error("대기열 ID가 없습니다.");
  if (!Number.isFinite(queueNumber) || !Number.isInteger(queueNumber) || queueNumber < 1) {
    throw new Error("1 이상의 정수 순번을 입력해 주세요.");
  }

  const { data, error } = await supabase
    .from("queues")
    .update({ queue_number: queueNumber })
    .eq("id", queueId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[updateQueueNumber] 실패", error);
    throw new Error(error.message || "순번 변경에 실패했습니다.");
  }
  if (!data) {
    throw new Error("대기열을 찾을 수 없습니다.");
  }
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
 * 결제 완료 (스마트 오더 pending):
 * 0) 실시간 storage_qty 사전 검증 — 부족 시 즉시 중단 (매출/상태 변경 없음)
 * 1) 재고 차감
 * 2) orders → paid, queues → completed
 * 3) sales_logs INSERT
 *
 * @param cartItems 키오스크 최종 장바구니(수동 추가 포함). 없으면 DB order_items 사용.
 */
export type PosPaymentCartItem = {
  productId: string;
  quantity: number;
  unitPrice?: number;
  productName?: string;
};

export async function completePosPayment(
  orderId: string,
  dayNumber?: EventDay,
  cartItems?: PosPaymentCartItem[]
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

  // 최종 장바구니(수동 추가 포함) 우선 — 없으면 DB order_items
  const sourceItems: Array<{
    product_id: string;
    quantity: number;
    product_name: string;
    unit_price?: number;
  }> =
    cartItems && cartItems.length > 0
      ? cartItems.map((item) => ({
          product_id: String(item.productId ?? "").trim(),
          quantity: Number(item.quantity) || 0,
          product_name: String(item.productName ?? "제품").trim() || "제품",
          unit_price:
            typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice)
              ? item.unitPrice
              : undefined,
        }))
      : (Array.isArray(order.order_items) ? order.order_items : []).map(
          (item) => ({
            product_id: String(item.product_id ?? "").trim(),
            quantity: Number(item.quantity) || 0,
            product_name: String(item.product_name ?? "제품").trim() || "제품",
          })
        );

  if (sourceItems.length === 0) {
    throw new Error("주문 품목이 없습니다.");
  }

  // 동일 product_id 수량 합산
  const qtyByProduct = new Map<
    string,
    { quantity: number; productName: string; unitPrice?: number }
  >();
  for (const item of sourceItems) {
    const productId = item.product_id;
    const quantity = item.quantity;
    const productName = item.product_name;
    if (!productId || quantity <= 0) {
      throw new Error(`잘못된 주문 품목: ${productName}`);
    }
    const prev = qtyByProduct.get(productId);
    if (prev) {
      prev.quantity += quantity;
    } else {
      qtyByProduct.set(productId, {
        quantity,
        productName,
        unitPrice: item.unit_price,
      });
    }
  }

  const productIds = [...qtyByProduct.keys()];

  // ── 0) 사전 재고 검증 (Pre-check) — 이 단계 전후로 매출/상태 변경 금지 ──
  const [{ data: productRows, error: productsError }, { data: inventoryRows, error: inventoryError }] =
    await Promise.all([
      supabase.from("products").select("id, name, price").in("id", productIds),
      supabase
        .from("inventory")
        .select("product_id, storage_qty")
        .in("product_id", productIds),
    ]);

  if (productsError) {
    console.error("[completePosPayment] products 조회 실패", productsError);
    throw new Error(productsError.message || "제품 정보 조회에 실패했습니다.");
  }
  if (inventoryError) {
    console.error("[completePosPayment] inventory 조회 실패", inventoryError);
    throw new Error(
      inventoryError.message || "재고 정보 조회에 실패했습니다."
    );
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

  const storageById = new Map(
    (inventoryRows ?? []).map((row) => [
      String(row.product_id),
      Number(row.storage_qty) || 0,
    ])
  );

  type SalePrep = {
    productId: string;
    quantity: number;
    unitPrice: number;
    productName: string;
    storageQty: number;
  };

  const prepared: SalePrep[] = [];

  for (const [productId, entry] of qtyByProduct) {
    const product = productById.get(productId);
    const productName = product?.name || entry.productName || "제품";
    const storageQty = storageById.has(productId)
      ? (storageById.get(productId) as number)
      : null;
    const unitPrice =
      typeof entry.unitPrice === "number" && Number.isFinite(entry.unitPrice)
        ? entry.unitPrice
        : (product?.price ?? 0);

    if (!product) {
      throw new Error(`제품 정보를 찾을 수 없습니다 (${productName}).`);
    }
    if (storageQty == null) {
      throw new Error(`"${productName}" 재고 정보를 찾을 수 없습니다.`);
    }
    if (storageQty < entry.quantity) {
      throw new Error(
        `재고가 부족하여 결제를 진행할 수 없습니다. (품목: ${productName}, 남은 재고: ${storageQty}개)`
      );
    }

    prepared.push({
      productId,
      quantity: entry.quantity,
      unitPrice,
      productName,
      storageQty,
    });
  }

  // ── 1) 재고 차감 (검증 통과 후에만) ──
  for (const item of prepared) {
    const { data: inv, error: invError } = await supabase
      .from("inventory")
      .select("storage_qty")
      .eq("product_id", item.productId)
      .maybeSingle();

    if (invError) {
      console.error("[completePosPayment] 재고 재조회 실패", invError);
      throw new Error(invError.message || "재고 재조회에 실패했습니다.");
    }

    const liveStorage = Number(inv?.storage_qty) || 0;
    if (liveStorage < item.quantity) {
      throw new Error(
        `재고가 부족하여 결제를 진행할 수 없습니다. (품목: ${item.productName}, 남은 재고: ${liveStorage}개)`
      );
    }

    const { error: updateError } = await supabase
      .from("inventory")
      .update({
        storage_qty: liveStorage - item.quantity,
        last_updated: new Date().toISOString(),
      })
      .eq("product_id", item.productId);

    if (updateError) {
      console.error("[completePosPayment] 재고 차감 실패", updateError);
      throw new Error(updateError.message || "재고 차감에 실패했습니다.");
    }
  }

  // ── 2) orders / queues 상태 변경 ──
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

  // ── 3) 매출 기록 INSERT (검증·차감·상태 변경이 모두 끝난 뒤에만) ──
  const paymentGroupId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  let customerName = "";
  const { data: queueRow } = await supabase
    .from("queues")
    .select("customer_name")
    .eq("id", order.queue_id)
    .maybeSingle();
  if (queueRow?.customer_name) {
    customerName = String(queueRow.customer_name).trim();
  }

  const saleRows = prepared.map((item) => ({
    product_id: item.productId,
    day_number: day,
    sold_from: "창고" as const,
    quantity: item.quantity,
    total_price: item.unitPrice * item.quantity,
    payment_group_id: paymentGroupId,
    order_id: orderId,
    customer_name: customerName || null,
  }));

  const { error: salesError } = await supabase
    .from("sales_logs")
    .insert(saleRows);

  if (salesError) {
    // 컬럼 미마이그레이션 시 레거시 insert 폴백
    if (/payment_group_id|customer_name|order_id/i.test(salesError.message)) {
      const legacyRows = prepared.map((item) => ({
        product_id: item.productId,
        day_number: day,
        sold_from: "창고" as const,
        quantity: item.quantity,
        total_price: item.unitPrice * item.quantity,
      }));
      const { error: legacyError } = await supabase
        .from("sales_logs")
        .insert(legacyRows);
      if (legacyError) {
        console.error("[completePosPayment] sales_logs insert 실패", legacyError);
        throw new Error(
          legacyError.message ||
            "매출 기록 저장에 실패했습니다. 재고·주문 상태는 이미 반영됐을 수 있습니다."
        );
      }
    } else {
      console.error("[completePosPayment] sales_logs insert 실패", salesError);
      throw new Error(
        salesError.message ||
          "매출 기록 저장에 실패했습니다. 재고·주문 상태는 이미 반영됐을 수 있습니다."
      );
    }
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


