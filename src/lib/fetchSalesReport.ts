import { supabase } from "@/lib/supabase";
import type { EventDay, StockLocation } from "@/types/dashboard";
import type {
  DaySalesStat,
  ProductSalesRank,
  SaleLogWithProduct,
  SalesReportSummary,
} from "@/types/salesReport";

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function fetchSaleLogsWithProducts(
  dayNumber?: EventDay
): Promise<SaleLogWithProduct[]> {
  let salesQuery = supabase
    .from("sales_logs")
    .select(
      "id, product_id, day_number, sold_from, quantity, total_price, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (dayNumber != null) {
    salesQuery = salesQuery.eq("day_number", dayNumber);
  }

  const [salesResult, productsResult] = await Promise.all([
    salesQuery,
    supabase.from("products").select("id, name, brand, company_type, price"),
  ]);

  if (salesResult.error) {
    throw new Error(
      salesResult.error.message || "판매 기록을 불러오지 못했습니다."
    );
  }

  if (productsResult.error) {
    throw new Error(
      productsResult.error.message || "제품 정보를 불러오지 못했습니다."
    );
  }

  const productMap = new Map(
    (productsResult.data ?? []).map((product) => [
      String(product.id),
      {
        name: String(product.name ?? "-"),
        brand: String(product.brand ?? "미지정"),
        companyType: String(product.company_type ?? "-"),
        unitPrice: toNumber(product.price),
      },
    ])
  );

  return (salesResult.data ?? []).map((row) => {
    const product = productMap.get(String(row.product_id));
    return {
      id: String(row.id),
      productId: String(row.product_id),
      dayNumber: toNumber(row.day_number),
      soldFrom: row.sold_from as StockLocation,
      quantity: toNumber(row.quantity),
      totalPrice: toNumber(row.total_price),
      createdAt: String(row.created_at ?? ""),
      productName: product?.name ?? "알 수 없음",
      brand: product?.brand ?? "미지정",
      companyType: product?.companyType ?? "-",
      unitPrice: product?.unitPrice ?? 0,
    };
  });
}

export function buildSalesReport(
  logs: SaleLogWithProduct[]
): SalesReportSummary {
  let totalRevenue = 0;
  let totalQuantity = 0;
  let ownRevenue = 0;
  let otherRevenue = 0;

  const dayMap = new Map<number, { quantity: number; revenue: number }>([
    [1, { quantity: 0, revenue: 0 }],
    [2, { quantity: 0, revenue: 0 }],
    [3, { quantity: 0, revenue: 0 }],
  ]);

  const productMap = new Map<
    string,
    {
      productName: string;
      brand: string;
      companyType: string;
      quantity: number;
      revenue: number;
    }
  >();

  for (const log of logs) {
    totalRevenue += log.totalPrice;
    totalQuantity += log.quantity;

    if (log.companyType === "자사") ownRevenue += log.totalPrice;
    else if (log.companyType === "타사") otherRevenue += log.totalPrice;

    const dayStat = dayMap.get(log.dayNumber);
    if (dayStat) {
      dayStat.quantity += log.quantity;
      dayStat.revenue += log.totalPrice;
    }

    const existing = productMap.get(log.productId);
    if (existing) {
      existing.quantity += log.quantity;
      existing.revenue += log.totalPrice;
    } else {
      productMap.set(log.productId, {
        productName: log.productName,
        brand: log.brand,
        companyType: log.companyType,
        quantity: log.quantity,
        revenue: log.totalPrice,
      });
    }
  }

  const byDay: DaySalesStat[] = ([1, 2, 3] as const).map((dayNumber) => {
    const stat = dayMap.get(dayNumber)!;
    return {
      dayNumber,
      quantity: stat.quantity,
      revenue: stat.revenue,
    };
  });

  const ranking: ProductSalesRank[] = Array.from(productMap.entries())
    .map(([productId, value]) => ({
      productId,
      productName: value.productName,
      brand: value.brand,
      companyType: value.companyType,
      quantity: value.quantity,
      revenue: value.revenue,
    }))
    .sort((a, b) => {
      if (b.quantity !== a.quantity) return b.quantity - a.quantity;
      return b.revenue - a.revenue;
    });

  return {
    totalRevenue,
    totalQuantity,
    ownRevenue,
    otherRevenue,
    byDay,
    ranking,
  };
}

/** 전체 행사 기간 누적 보고서 (일차 필터 없음) */
export async function fetchSalesReport(): Promise<SalesReportSummary> {
  const logs = await fetchSaleLogsWithProducts();
  return buildSalesReport(logs);
}
