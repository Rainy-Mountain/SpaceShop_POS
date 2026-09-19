import { supabase } from "@/lib/supabase";
import {
  LOCATION_LABELS,
  LOCATION_TO_FIELD,
  type InventoryQtyField,
  type MovementLogItem,
  type RecentActivityItem,
  type SaleLogItem,
  type StockLocation,
} from "@/types/dashboard";

function toQty(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function fetchInventoryQtys(productId: string): Promise<{
  backup_qty: number;
  storage_qty: number;
  display_qty: number;
}> {
  const { data, error } = await supabase
    .from("inventory")
    .select("backup_qty, storage_qty, display_qty")
    .eq("product_id", productId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("해당 제품의 재고 정보를 찾을 수 없습니다.");

  return {
    backup_qty: toQty(data.backup_qty),
    storage_qty: toQty(data.storage_qty),
    display_qty: toQty(data.display_qty),
  };
}

async function updateInventoryQtys(
  productId: string,
  next: Record<InventoryQtyField, number>
): Promise<void> {
  const { error } = await supabase
    .from("inventory")
    .update({
      ...next,
      last_updated: new Date().toISOString(),
    })
    .eq("product_id", productId);

  if (error) throw new Error(error.message);
}

export async function updateProductPrice(
  productId: string,
  price: number
): Promise<void> {
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("가격은 0 이상의 숫자여야 합니다.");
  }

  const { error } = await supabase
    .from("products")
    .update({ price })
    .eq("id", productId);

  if (error) throw new Error(error.message);
}

/** 샵/백업 재고 개별 필드 수동 수정 */
export async function updateInventoryField(
  productId: string,
  field: "storage_qty" | "backup_qty",
  quantity: number
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error("재고 수량은 0 이상의 정수여야 합니다.");
  }

  const { data: existing, error: findError } = await supabase
    .from("inventory")
    .select("product_id")
    .eq("product_id", productId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);

  if (existing?.product_id) {
    const { error } = await supabase
      .from("inventory")
      .update({
        [field]: quantity,
        last_updated: new Date().toISOString(),
      })
      .eq("product_id", productId);

    if (error) throw new Error(error.message);
    return;
  }

  // inventory 행이 없으면 생성
  const payload = {
    product_id: productId,
    storage_qty: field === "storage_qty" ? quantity : 0,
    backup_qty: field === "backup_qty" ? quantity : 0,
    display_qty: 0,
    last_updated: new Date().toISOString(),
  };

  const { error } = await supabase.from("inventory").insert(payload);
  if (error) throw new Error(error.message);
}

export async function deleteProduct(productId: string): Promise<void> {
  const { error } = await supabase.from("products").delete().eq("id", productId);

  if (error) throw new Error(error.message);
}

export async function transferStock(params: {
  productId: string;
  from: StockLocation;
  to: StockLocation;
  quantity: number;
}): Promise<void> {
  const { productId, from, to, quantity } = params;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("이동 수량은 1 이상의 정수여야 합니다.");
  }

  if (from === to) {
    throw new Error("출발지와 도착지가 같습니다.");
  }

  const current = await fetchInventoryQtys(productId);
  const fromField = LOCATION_TO_FIELD[from];
  const toField = LOCATION_TO_FIELD[to];

  if (current[fromField] < quantity) {
    throw new Error(
      `${LOCATION_LABELS[from]} 재고가 부족합니다. (현재 ${current[fromField]}개)`
    );
  }

  const next: Record<InventoryQtyField, number> = {
    backup_qty: current.backup_qty,
    storage_qty: current.storage_qty,
    display_qty: current.display_qty,
  };

  next[fromField] -= quantity;
  next[toField] += quantity;

  await updateInventoryQtys(productId, next);

  const { error: logError } = await supabase.from("movement_logs").insert({
    product_id: productId,
    from_location: from,
    to_location: to,
    quantity,
  });

  if (logError) {
    throw new Error(
      `재고는 이동됐지만 이동 기록 저장에 실패했습니다: ${logError.message}`
    );
  }
}

export async function registerSale(params: {
  productId: string;
  dayNumber: number;
  soldFrom: StockLocation;
  quantity: number;
  unitPrice: number;
  paymentGroupId?: string;
  orderId?: string | null;
}): Promise<void> {
  const {
    productId,
    dayNumber,
    soldFrom,
    quantity,
    unitPrice,
    paymentGroupId,
    orderId,
  } = params;

  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("판매 수량은 1 이상의 정수여야 합니다.");
  }

  const current = await fetchInventoryQtys(productId);
  const field = LOCATION_TO_FIELD[soldFrom];

  if (current[field] < quantity) {
    throw new Error(
      `재고가 부족하여 결제를 진행할 수 없습니다. (품목: ${productId}, 남은 재고: ${current[field]}개)`
    );
  }

  const totalPrice = unitPrice * quantity;
  const nextQty = current[field] - quantity;

  // 1) 재고 차감 먼저 — 실패 시 매출 기록 없음
  await updateInventoryQtys(productId, {
    backup_qty: current.backup_qty,
    storage_qty: current.storage_qty,
    display_qty: current.display_qty,
    [field]: nextQty,
  });

  // 2) 매출 기록 — sales_logs에 customer_name 컬럼을 쓰지 않음 (스키마 캐시 에러 방지)
  const corePayload: Record<string, unknown> = {
    product_id: productId,
    day_number: dayNumber,
    sold_from: soldFrom,
    quantity,
    total_price: totalPrice,
  };

  const withGroup: Record<string, unknown> = { ...corePayload };
  if (paymentGroupId) withGroup.payment_group_id = paymentGroupId;
  if (orderId) withGroup.order_id = orderId;

  let { error: saleError } = await supabase.from("sales_logs").insert(withGroup);

  // payment_group_id / order_id 미마이그레이션 → 핵심 컬럼만 재시도
  if (
    saleError &&
    /payment_group_id|order_id|customer_name|schema cache|could not find/i.test(
      saleError.message
    )
  ) {
    const retry = await supabase.from("sales_logs").insert(corePayload);
    saleError = retry.error;
  }

  if (saleError) {
    // 재고는 이미 차감됨 — 복구 시도
    try {
      await updateInventoryQtys(productId, current);
    } catch (rollbackError) {
      console.error("[registerSale] 매출 실패 후 재고 롤백 실패", rollbackError);
    }
    throw new Error(saleError.message);
  }
}

/** 키오스크 장바구니 일괄 결제 (샵 재고에서 차감) — 사전 재고 검증 포함 */
export async function checkoutKioskCart(params: {
  dayNumber: number;
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    productName?: string;
  }>;
}): Promise<void> {
  const { dayNumber, items } = params;

  if (items.length === 0) {
    throw new Error("장바구니가 비어 있습니다.");
  }

  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("판매 수량은 1 이상의 정수여야 합니다.");
    }
  }

  // 동일 product_id 합산
  const merged = new Map<
    string,
    { quantity: number; unitPrice: number; productName?: string }
  >();
  for (const item of items) {
    const prev = merged.get(item.productId);
    if (prev) {
      prev.quantity += item.quantity;
    } else {
      merged.set(item.productId, {
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        productName: item.productName,
      });
    }
  }

  const productIds = [...merged.keys()];

  // 0) 사전 재고 검증 — 부족 시 매출 INSERT 절대 실행 안 함
  const [{ data: productRows, error: productsError }, { data: inventoryRows, error: inventoryError }] =
    await Promise.all([
      supabase.from("products").select("id, name").in("id", productIds),
      supabase
        .from("inventory")
        .select("product_id, storage_qty")
        .in("product_id", productIds),
    ]);

  if (productsError) {
    throw new Error(productsError.message || "제품 정보 조회에 실패했습니다.");
  }
  if (inventoryError) {
    throw new Error(inventoryError.message || "재고 정보 조회에 실패했습니다.");
  }

  const nameById = new Map(
    (productRows ?? []).map((row) => [
      String(row.id),
      String(row.name ?? "제품"),
    ])
  );
  const storageById = new Map(
    (inventoryRows ?? []).map((row) => [
      String(row.product_id),
      Number(row.storage_qty) || 0,
    ])
  );

  for (const [productId, entry] of merged) {
    const productName =
      entry.productName || nameById.get(productId) || "제품";
    const storageQty = storageById.has(productId)
      ? (storageById.get(productId) as number)
      : null;

    if (storageQty == null) {
      throw new Error(`"${productName}" 재고 정보를 찾을 수 없습니다.`);
    }
    if (storageQty < entry.quantity) {
      throw new Error(
        `재고가 부족하여 결제를 진행할 수 없습니다. (품목: ${productName}, 남은 재고: ${storageQty}개)`
      );
    }
  }

  // 검증 통과 후에만 순차 결제 (재고 차감 + 매출) — 동일 payment_group_id로 묶음
  const paymentGroupId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  for (const [productId, entry] of merged) {
    // 워크인: order_id / customer_name 없이 결제 (null 허용)
    await registerSale({
      productId,
      dayNumber,
      soldFrom: "창고",
      quantity: entry.quantity,
      unitPrice: entry.unitPrice,
      paymentGroupId,
    });
  }
}

export async function fetchRecentActivities(
  limit = 30
): Promise<RecentActivityItem[]> {
  const [salesResult, movementsResult, productsResult] = await Promise.all([
    supabase
      .from("sales_logs")
      .select("id, product_id, day_number, sold_from, quantity, total_price, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("movement_logs")
      .select(
        "id, product_id, from_location, to_location, quantity, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase.from("products").select("id, name, brand"),
  ]);

  if (salesResult.error) {
    console.error("sales_logs 조회 실패:", salesResult.error.message);
  }
  if (movementsResult.error) {
    console.error("movement_logs 조회 실패:", movementsResult.error.message);
  }

  const productMap = new Map<string, { name: string; brand: string }>();
  for (const product of productsResult.data ?? []) {
    productMap.set(String(product.id), {
      name: String(product.name ?? "알 수 없음"),
      brand: String(product.brand ?? ""),
    });
  }

  const sales: SaleLogItem[] = (salesResult.data ?? []).map((row) => {
    const product = productMap.get(String(row.product_id));
    return {
      id: String(row.id),
      type: "sale",
      productId: String(row.product_id),
      productName: product?.name ?? "알 수 없음",
      brand: product?.brand ?? "",
      dayNumber: toQty(row.day_number),
      soldFrom: row.sold_from as StockLocation,
      quantity: toQty(row.quantity),
      totalPrice: toQty(row.total_price),
      createdAt: String(row.created_at ?? ""),
    };
  });

  const movements: MovementLogItem[] = (movementsResult.data ?? []).map(
    (row) => {
      const product = productMap.get(String(row.product_id));
      return {
        id: String(row.id),
        type: "movement",
        productId: String(row.product_id),
        productName: product?.name ?? "알 수 없음",
        brand: product?.brand ?? "",
        fromLocation: row.from_location as StockLocation,
        toLocation: row.to_location as StockLocation,
        quantity: toQty(row.quantity),
        createdAt: String(row.created_at ?? ""),
      };
    }
  );

  return [...sales, ...movements].sort((a, b) => {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export async function undoSale(saleId: string): Promise<void> {
  const { data: sale, error: findError } = await supabase
    .from("sales_logs")
    .select("id, product_id, sold_from, quantity, total_price")
    .eq("id", saleId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (!sale) throw new Error("취소할 판매 내역을 찾을 수 없습니다.");

  const productId = String(sale.product_id);
  const soldFrom = sale.sold_from as StockLocation;
  const quantity = toQty(sale.quantity);
  const field = LOCATION_TO_FIELD[soldFrom];

  const current = await fetchInventoryQtys(productId);
  const next: Record<InventoryQtyField, number> = {
    backup_qty: current.backup_qty,
    storage_qty: current.storage_qty,
    display_qty: current.display_qty,
  };
  next[field] += quantity;

  await updateInventoryQtys(productId, next);

  const { error: deleteError } = await supabase
    .from("sales_logs")
    .delete()
    .eq("id", saleId);

  if (deleteError) {
    throw new Error(
      `재고는 복구됐지만 판매 기록 삭제에 실패했습니다: ${deleteError.message}`
    );
  }
}

/** 결제 건(영수증) 전체 취소 — 모든 품목 재고 원복 후 sales_logs 삭제 */
export async function undoSaleGroup(saleIds: string[]): Promise<void> {
  const ids = [...new Set(saleIds.filter(Boolean))];
  if (ids.length === 0) throw new Error("취소할 판매 내역이 없습니다.");

  const { data: sales, error: findError } = await supabase
    .from("sales_logs")
    .select("id, product_id, sold_from, quantity")
    .in("id", ids);

  if (findError) throw new Error(findError.message);
  if (!sales || sales.length === 0) {
    throw new Error("취소할 판매 내역을 찾을 수 없습니다.");
  }

  // 1) 품목별 재고 원복
  for (const sale of sales) {
    const productId = String(sale.product_id);
    const soldFrom = sale.sold_from as StockLocation;
    const quantity = toQty(sale.quantity);
    const field = LOCATION_TO_FIELD[soldFrom];

    const current = await fetchInventoryQtys(productId);
    const next: Record<InventoryQtyField, number> = {
      backup_qty: current.backup_qty,
      storage_qty: current.storage_qty,
      display_qty: current.display_qty,
    };
    next[field] += quantity;
    await updateInventoryQtys(productId, next);
  }

  // 2) 판매 기록 일괄 삭제
  const { error: deleteError } = await supabase
    .from("sales_logs")
    .delete()
    .in("id", ids);

  if (deleteError) {
    throw new Error(
      `재고는 복구됐지만 판매 기록 삭제에 실패했습니다: ${deleteError.message}`
    );
  }
}

export async function undoMovement(movementId: string): Promise<void> {
  const { data: movement, error: findError } = await supabase
    .from("movement_logs")
    .select("id, product_id, from_location, to_location, quantity")
    .eq("id", movementId)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (!movement) throw new Error("취소할 이동 내역을 찾을 수 없습니다.");

  const productId = String(movement.product_id);
  const from = movement.from_location as StockLocation;
  const to = movement.to_location as StockLocation;
  const quantity = toQty(movement.quantity);

  const fromField = LOCATION_TO_FIELD[from];
  const toField = LOCATION_TO_FIELD[to];
  const current = await fetchInventoryQtys(productId);

  if (current[toField] < quantity) {
    throw new Error(
      `이동 취소 불가: ${LOCATION_LABELS[to]} 재고가 부족합니다. (현재 ${current[toField]}개)`
    );
  }

  const next: Record<InventoryQtyField, number> = {
    backup_qty: current.backup_qty,
    storage_qty: current.storage_qty,
    display_qty: current.display_qty,
  };
  next[fromField] += quantity;
  next[toField] -= quantity;

  await updateInventoryQtys(productId, next);

  const { error: deleteError } = await supabase
    .from("movement_logs")
    .delete()
    .eq("id", movementId);

  if (deleteError) {
    throw new Error(
      `재고는 복구됐지만 이동 기록 삭제에 실패했습니다: ${deleteError.message}`
    );
  }
}
