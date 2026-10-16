import { fetchAllRows } from "@/lib/fetchAllRows";
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

/** 제품별 1/2/3일차·총 판매량 */
export type ProductDaySales = {
  day1: number;
  day2: number;
  day3: number;
  total: number;
};

export function emptyDaySales(): ProductDaySales {
  return { day1: 0, day2: 0, day3: 0, total: 0 };
}

export function mapProductToRow(
  product: ProductWithInventory,
  daySales: ProductDaySales = emptyDaySales()
): DashboardRow {
  const inventory = normalizeInventory(product.inventory);

  const storageQty = toNumber(inventory?.storage_qty);
  const backupQty = toNumber(inventory?.backup_qty);
  const totalQty = storageQty + backupQty;
  const soldTotal = daySales.total;

  return {
    id: product.id,
    brand: product.brand || "미지정",
    name: product.name || "-",
    companyType: product.company_type || "-",
    price: toNumber(product.price),
    liquorType: String(product.liquor_type ?? "").trim(),
    storageQty,
    backupQty,
    totalQty,
    soldQty: soldTotal,
    soldDay1: daySales.day1,
    soldDay2: daySales.day2,
    soldDay3: daySales.day3,
    initialQty: totalQty + soldTotal,
  };
}

export interface SalesTotals {
  quantity: number;
  revenue: number;
  day1Quantity: number;
  day2Quantity: number;
  day3Quantity: number;
}

async function fetchSalesByDayAggregation(): Promise<{
  byProduct: Map<string, ProductDaySales>;
  totals: SalesTotals;
}> {
  const data = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase.from("sales_logs").select("id, product_id, quantity, total_price, day_number")
      .is("voided_at", null).order("id").range(from, to)
  );

  const byProduct = new Map<string, ProductDaySales>();
  let quantity = 0;
  let revenue = 0;
  let day1Quantity = 0;
  let day2Quantity = 0;
  let day3Quantity = 0;

  for (const row of data ?? []) {
    const productId = String(row.product_id ?? "");
    const qty = toNumber(row.quantity);
    const price = toNumber(row.total_price);
    const day = toNumber(row.day_number);

    quantity += qty;
    revenue += price;
    if (day === 1) day1Quantity += qty;
    else if (day === 2) day2Quantity += qty;
    else if (day === 3) day3Quantity += qty;

    if (!productId) continue;

    const entry = byProduct.get(productId) ?? emptyDaySales();
    if (day === 1) entry.day1 += qty;
    else if (day === 2) entry.day2 += qty;
    else if (day === 3) entry.day3 += qty;
    entry.total += qty;
    byProduct.set(productId, entry);
  }

  return {
    byProduct,
    totals: {
      quantity,
      revenue,
      day1Quantity,
      day2Quantity,
      day3Quantity,
    },
  };
}

/** 통계/행별 일차 판매량 조용히 재계산 */
export async function fetchDashboardSalesStats(
  _dayNumber?: EventDay
): Promise<{
  byProduct: Map<string, ProductDaySales>;
  totals: SalesTotals;
}> {
  return fetchSalesByDayAggregation();
}

export interface InventoryDashboardData {
  rows: DashboardRow[];
  salesTotals: SalesTotals;
}

export async function fetchInventoryDashboardData(
  _dayNumber?: EventDay,
  options?: { orderBy?: "brand" | "created" }
): Promise<InventoryDashboardData> {
  const orderBy = options?.orderBy ?? "brand";

  const [products, sales] = await Promise.all([
    fetchAllRows<ProductWithInventory>((from, to) => {
      let query = supabase.from("products").select("*, inventory(*)");
      query = orderBy === "created"
        ? query.order("created_at", { ascending: true })
        : query.order("brand", { ascending: true }).order("name", { ascending: true });
      return query.order("id").range(from, to);
    }),
    fetchSalesByDayAggregation(),
  ]);

  const rows = products.map((product) =>
    mapProductToRow(
      product,
      sales.byProduct.get(product.id) ?? emptyDaySales()
    )
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
