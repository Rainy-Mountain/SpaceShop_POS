import { supabase } from "@/lib/supabase";
import type {
  DashboardRow,
  EventDay,
  InventoryRecord,
  ProductWithInventory,
} from "@/types/dashboard";

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeInventory(
  inventory: ProductWithInventory["inventory"]
): InventoryRecord | null {
  if (!inventory) return null;
  if (Array.isArray(inventory)) return inventory[0] ?? null;
  return inventory;
}

export function mapProductToRow(
  product: ProductWithInventory,
  soldQty = 0
): DashboardRow {
  const inventory = normalizeInventory(product.inventory);

  const storageQty = toNumber(inventory?.storage_qty);
  const backupQty = toNumber(inventory?.backup_qty);

  return {
    id: product.id,
    brand: product.brand || "미지정",
    name: product.name || "-",
    companyType: product.company_type || "-",
    price: toNumber(product.price),
    storageQty,
    backupQty,
    totalQty: storageQty + backupQty,
    soldQty,
  };
}

export interface SalesTotals {
  quantity: number;
  revenue: number;
}

async function fetchSalesTotals(dayNumber?: EventDay): Promise<{
  byProduct: Map<string, number>;
  totals: SalesTotals;
}> {
  let query = supabase
    .from("sales_logs")
    .select("product_id, quantity, total_price");

  if (dayNumber != null) {
    query = query.eq("day_number", dayNumber);
  }

  const { data, error } = await query;

  if (error) {
    console.error("sales_logs 조회 실패:", error.message);
    return {
      byProduct: new Map(),
      totals: { quantity: 0, revenue: 0 },
    };
  }

  const byProduct = new Map<string, number>();
  let quantity = 0;
  let revenue = 0;

  for (const row of data ?? []) {
    const productId = String(row.product_id ?? "");
    const qty = toNumber(row.quantity);
    const price = toNumber(row.total_price);

    quantity += qty;
    revenue += price;

    if (productId) {
      byProduct.set(productId, (byProduct.get(productId) ?? 0) + qty);
    }
  }

  return { byProduct, totals: { quantity, revenue } };
}

/** 통계/행별 soldQty만 조용히 다시 계산 (전체 페이지 리로드 없음) */
export async function fetchDashboardSalesStats(
  dayNumber?: EventDay
): Promise<{
  byProduct: Map<string, number>;
  totals: SalesTotals;
}> {
  return fetchSalesTotals(dayNumber);
}

export interface InventoryDashboardData {
  rows: DashboardRow[];
  salesTotals: SalesTotals;
}

export async function fetchInventoryDashboardData(
  dayNumber?: EventDay,
  options?: { orderBy?: "brand" | "created" }
): Promise<InventoryDashboardData> {
  const orderBy = options?.orderBy ?? "brand";

  let productsQuery = supabase.from("products").select("*, inventory(*)");

  if (orderBy === "created") {
    productsQuery = productsQuery.order("created_at", { ascending: true });
  } else {
    productsQuery = productsQuery
      .order("brand", { ascending: true })
      .order("name", { ascending: true });
  }

  const [{ data, error }, sales] = await Promise.all([
    productsQuery,
    fetchSalesTotals(dayNumber),
  ]);

  if (error) {
    throw new Error(error.message || "재고 데이터를 불러오지 못했습니다.");
  }

  const products = (data ?? []) as ProductWithInventory[];
  const rows = products.map((product) =>
    mapProductToRow(product, sales.byProduct.get(product.id) ?? 0)
  );

  return {
    rows,
    salesTotals: sales.totals,
  };
}

/** @deprecated use fetchInventoryDashboardData */
export async function fetchInventoryRows(): Promise<DashboardRow[]> {
  const data = await fetchInventoryDashboardData();
  return data.rows;
}
