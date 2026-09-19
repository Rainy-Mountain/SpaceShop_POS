import { supabase } from "@/lib/supabase";
import type { EventDay, StockLocation } from "@/types/dashboard";
import type {
  DaySalesStat,
  ProductSalesRank,
  SaleLogWithProduct,
  SalePaymentGroup,
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

function normalizeJoinedRelation<T extends object>(value: unknown): T | null {
  if (!value) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

/** sales_logs / orders / queues 에서 손님 4자리 번호 추출 */
function resolveGuestCustomerName(options: {
  salesCustomerName?: string | null;
  orderCustomerName?: string | null;
  queueCustomerName?: string | null;
}): string | null {
  const candidates = [
    options.salesCustomerName,
    options.orderCustomerName,
    options.queueCustomerName,
  ];
  for (const raw of candidates) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    // 워크인 표기·플레이스홀더는 조인 보강 대상으로 취급
    if (value === "현장" || value === "손님" || value === "현장 손님") continue;
    return value;
  }
  return null;
}

export async function fetchSaleLogsWithProducts(
  dayNumber?: EventDay
): Promise<SaleLogWithProduct[]> {
  const selectWithJoin =
    "id, product_id, day_number, sold_from, quantity, total_price, created_at, payment_group_id, order_id, customer_name, orders ( customer_name, queue_id, queues ( customer_name ) )";
  const selectWithGroup =
    "id, product_id, day_number, sold_from, quantity, total_price, created_at, payment_group_id, order_id, customer_name";
  const selectLegacy =
    "id, product_id, day_number, sold_from, quantity, total_price, created_at";

  let salesQuery = supabase
    .from("sales_logs")
    .select(selectWithJoin)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (dayNumber != null) {
    salesQuery = salesQuery.eq("day_number", dayNumber);
  }

  let salesResult = await salesQuery;
  let usedJoin = !salesResult.error;

  // FK/조인 미설정 시 기본 컬럼만
  if (
    salesResult.error &&
    /orders|queues|relationship|foreign key/i.test(salesResult.error.message)
  ) {
    let fallbackQuery = supabase
      .from("sales_logs")
      .select(selectWithGroup)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (dayNumber != null) {
      fallbackQuery = fallbackQuery.eq("day_number", dayNumber);
    }
    salesResult = await fallbackQuery;
    usedJoin = false;
  }

  // 마이그레이션 전 DB 호환
  if (
    salesResult.error &&
    /payment_group_id|customer_name|order_id/i.test(salesResult.error.message)
  ) {
    let legacyQuery = supabase
      .from("sales_logs")
      .select(selectLegacy)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (dayNumber != null) {
      legacyQuery = legacyQuery.eq("day_number", dayNumber);
    }
    salesResult = await legacyQuery;
    usedJoin = false;
  }

  const productsResult = await supabase
    .from("products")
    .select("id, name, brand, company_type, price");

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

  // 조인 실패 시 order_id로 orders→queues 일괄 보강
  const orderGuestById = new Map<string, string>();
  if (!usedJoin) {
    const orderIds = [
      ...new Set(
        (salesResult.data ?? [])
          .map((row) => {
            const ext = row as { order_id?: string | null };
            return ext.order_id ? String(ext.order_id) : "";
          })
          .filter(Boolean)
      ),
    ];
    if (orderIds.length > 0) {
      const { data: orderRows } = await supabase
        .from("orders")
        .select("id, customer_name, queues ( customer_name )")
        .in("id", orderIds);
      for (const row of orderRows ?? []) {
        const queue = normalizeJoinedRelation<{ customer_name?: string | null }>(
          row.queues
        );
        const guest = resolveGuestCustomerName({
          orderCustomerName: row.customer_name as string | null,
          queueCustomerName: queue?.customer_name,
        });
        if (guest) orderGuestById.set(String(row.id), guest);
      }
    }
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
    const rowExt = row as {
      payment_group_id?: string | null;
      order_id?: string | null;
      customer_name?: string | null;
      orders?: unknown;
    };

    const orderRel = normalizeJoinedRelation<{
      customer_name?: string | null;
      queues?: unknown;
    }>(rowExt.orders);
    const queueRel = normalizeJoinedRelation<{
      customer_name?: string | null;
    }>(orderRel?.queues);

    const orderId = rowExt.order_id ? String(rowExt.order_id) : null;
    const guestName =
      resolveGuestCustomerName({
        salesCustomerName: rowExt.customer_name,
        orderCustomerName: orderRel?.customer_name,
        queueCustomerName: queueRel?.customer_name,
      }) ||
      (orderId ? orderGuestById.get(orderId) ?? null : null);

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
      paymentGroupId: rowExt.payment_group_id
        ? String(rowExt.payment_group_id)
        : null,
      orderId,
      customerName: guestName,
    };
  });
}

function paymentGroupKey(log: SaleLogWithProduct): string {
  if (log.paymentGroupId) return `pg:${log.paymentGroupId}`;
  if (log.orderId) return `ord:${log.orderId}`;
  // 레거시: 동일 초 단위 created_at 묶음
  const t = new Date(log.createdAt);
  if (!Number.isNaN(t.getTime())) {
    return `ts:${t.toISOString().slice(0, 19)}`;
  }
  return `id:${log.id}`;
}

/** 판매 로그를 결제(영수증) 단위로 그룹화 */
export function groupSalesByPayment(
  logs: SaleLogWithProduct[]
): SalePaymentGroup[] {
  const map = new Map<string, SalePaymentGroup>();

  for (const log of logs) {
    const key = paymentGroupKey(log);
    const existing = map.get(key);
    const item = {
      saleId: log.id,
      productId: log.productId,
      productName: log.productName,
      brand: log.brand,
      quantity: log.quantity,
      totalPrice: log.totalPrice,
    };

    if (existing) {
      existing.items.push(item);
      existing.saleIds.push(log.id);
      existing.totalPrice += log.totalPrice;
      if (
        (!existing.customerName ||
          existing.customerName === "현장" ||
          existing.customerName === "현장 손님") &&
        log.customerName
      ) {
        existing.customerName = log.customerName;
      }
    } else {
      map.set(key, {
        groupKey: key,
        paymentGroupId: log.paymentGroupId ?? null,
        orderId: log.orderId ?? null,
        // 실제 4자리만 넣고, 없으면 빈 값 — UI에서 '현장 손님' 처리
        customerName: log.customerName?.trim() || "",
        createdAt: log.createdAt,
        dayNumber: log.dayNumber,
        items: [item],
        totalPrice: log.totalPrice,
        saleIds: [log.id],
      });
    }
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function fetchSalePaymentGroups(
  dayNumber?: EventDay
): Promise<SalePaymentGroup[]> {
  const logs = await fetchSaleLogsWithProducts(dayNumber);
  return groupSalesByPayment(logs);
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
