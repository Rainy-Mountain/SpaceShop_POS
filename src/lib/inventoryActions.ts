import { completeSale, voidSales } from "@/lib/paymentActions";
import { supabase } from "@/lib/supabase";
import {
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

  if (error) {
    if (error.code === "23503") throw new Error("판매 또는 주문 이력이 있는 상품은 삭제할 수 없습니다.");
    throw new Error(error.message);
  }
}

export async function transferStock(params: {
  productId: string; from: StockLocation; to: StockLocation; quantity: number;
}): Promise<void> {
  const { error } = await supabase.rpc("move_stock", {
    p_product_id: params.productId, p_from: params.from,
    p_to: params.to, p_quantity: params.quantity,
  });
  if (error) throw new Error(error.message);
}

export async function registerSale(params: {
  productId: string; dayNumber: number; soldFrom: StockLocation;
  quantity: number; unitPrice: number; paymentGroupId?: string; orderId?: string;
}): Promise<void> {
  await completeSale({
    paymentId: params.paymentGroupId ?? params.orderId ?? crypto.randomUUID(),
    orderId: params.orderId, dayNumber: params.dayNumber,
    items: [{ productId: params.productId, quantity: params.quantity,
      unitPrice: params.unitPrice, soldFrom: params.soldFrom }],
  });
}

/** 전체 장바구니를 하나의 DB 트랜잭션으로 확정한다. */
export async function checkoutKioskCart(params: {
  paymentId: string;
  dayNumber: number;
  items: Array<{ productId: string; quantity: number; unitPrice: number; productName?: string }>;
}): Promise<void> {
  await completeSale({
    paymentId: params.paymentId, dayNumber: params.dayNumber,
    items: params.items.map((item) => ({ ...item, soldFrom: "창고" as const })),
  });
}

export async function fetchRecentActivities(
  limit = 30
): Promise<RecentActivityItem[]> {
  const [salesResult, movementsResult, productsResult] = await Promise.all([
    supabase
      .from("sales_logs")
      .select("id, product_id, day_number, sold_from, quantity, total_price, created_at")
      .is("voided_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("movement_logs")
      .select(
        "id, product_id, from_location, to_location, quantity, created_at"
      )
      .is("reversed_at", null)
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
  await voidSales([saleId]);
}

export async function undoSaleGroup(saleIds: string[]): Promise<void> {
  await voidSales(saleIds);
}

export async function undoMovement(movementId: string): Promise<void> {
  const { error } = await supabase.rpc("undo_movement", { p_movement_id: movementId });
  if (error) throw new Error(error.message);
}
