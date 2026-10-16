import { fetchAllRows, fetchIdBatches } from "@/lib/fetchAllRows";
import { paymentKey } from "@/lib/paymentIdentity";
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



function isPlaceholderGuest(value: string): boolean {
  return (
    !value ||
    value === "현장" ||
    value === "손님" ||
    value === "현장 손님" ||
    value === "워크인"
  );
}

function normalizePhoneTail(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (isPlaceholderGuest(value)) return null;
  return value;
}

type GuestInfo = {
  customerName: string | null;
  queueNumber: number | null;
  queueId: string | null;
};

type QueueGuestRow = {
  queue_number?: number | null;
  customer_name?: string | null;
};

/** queues 조인 우선 → guest_* → orders 스냅샷 */
function resolveGuestFromSources(options: {
  queues?: QueueGuestRow | null;
  orderCustomerName?: unknown;
  orderQueueNumber?: unknown;
  guestCustomerName?: unknown;
  guestQueueNumber?: unknown;
  queueId?: string | null;
}): GuestInfo {
  const fromQueuePhone = normalizePhoneTail(options.queues?.customer_name);
  const fromQueueNum =
    (Number(options.queues?.queue_number) || 0) > 0
      ? Number(options.queues?.queue_number)
      : null;

  const fromGuestPhone = normalizePhoneTail(options.guestCustomerName);
  const fromGuestNum =
    (Number(options.guestQueueNumber) || 0) > 0
      ? Number(options.guestQueueNumber)
      : null;

  const fromOrderPhone = normalizePhoneTail(options.orderCustomerName);
  const fromOrderNum =
    (Number(options.orderQueueNumber) || 0) > 0
      ? Number(options.orderQueueNumber)
      : null;

  return {
    customerName: fromQueuePhone || fromGuestPhone || fromOrderPhone || null,
    queueNumber: fromQueueNum ?? fromGuestNum ?? fromOrderNum ?? null,
    queueId: options.queueId ?? null,
  };
}

async function fetchQueuesByIds(queueIds: string[]): Promise<Map<string, QueueGuestRow>> {
  const rows = await fetchIdBatches<Record<string, unknown>>(queueIds, (ids) =>
    supabase.from("queues").select("id, queue_number, customer_name").in("id", ids)
  );
  return new Map(rows.map((row) => [String(row.id), {
    queue_number: row.queue_number as number | null,
    customer_name: row.customer_name as string | null,
  }]));
}

async function fetchGuestInfoByOrderIds(orderIds: string[]): Promise<Map<string, GuestInfo>> {
  const rows = await fetchIdBatches<Record<string, unknown>>(orderIds, (ids) =>
    supabase.from("orders").select("id, customer_name, queue_number, queue_id").in("id", ids)
  );
  const queueIds = rows.map((row) => String(row.queue_id ?? "")).filter(Boolean);
  const queues = await fetchQueuesByIds(queueIds);
  return new Map(rows.map((row) => {
    const queueId = row.queue_id ? String(row.queue_id) : null;
    return [String(row.id), resolveGuestFromSources({
      queues: queueId ? queues.get(queueId) : null,
      orderCustomerName: row.customer_name, orderQueueNumber: row.queue_number, queueId,
    })];
  }));
}

export async function fetchSaleLogsWithProducts(
  dayNumber?: EventDay
): Promise<SaleLogWithProduct[]> {
  const columns = "id, product_id, day_number, sold_from, quantity, total_price, created_at, payment_group_id, order_id, queue_id, guest_customer_name, guest_queue_number";
  const [rows, products] = await Promise.all([
    fetchAllRows<Record<string, unknown>>((from, to) => {
      let query = supabase.from("sales_logs").select(columns).is("voided_at", null)
        .order("created_at", { ascending: false }).order("id").range(from, to);
      if (dayNumber != null) query = query.eq("day_number", dayNumber);
      return query;
    }),
    fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase.from("products").select("id, name, brand, company_type, price")
        .order("id").range(from, to)
    ),
  ]);

  const orderIds = [
    ...new Set(
      rows
        .map((row) => {
          const ext = row as { order_id?: string | null };
          return ext.order_id ? String(ext.order_id) : "";
        })
        .filter(Boolean)
    ),
  ];
  const directQueueIds = [
    ...new Set(
      rows
        .map((row) => {
          const ext = row as { queue_id?: string | null };
          return ext.queue_id ? String(ext.queue_id) : "";
        })
        .filter(Boolean)
    ),
  ];

  // orders.queues 조인 + sales_logs.queue_id → queues 직접 조회
  const [guestByOrderId, queueById] = await Promise.all([
    fetchGuestInfoByOrderIds(orderIds),
    fetchQueuesByIds(directQueueIds),
  ]);

  const productMap = new Map(
    products.map((product) => [
      String(product.id),
      {
        name: String(product.name ?? "-"),
        brand: String(product.brand ?? "미지정"),
        companyType: String(product.company_type ?? "-"),
        unitPrice: toNumber(product.price),
      },
    ])
  );

  return rows.map((row) => {
    const product = productMap.get(String(row.product_id));
    const rowExt = row as {
      payment_group_id?: string | null;
      order_id?: string | null;
      queue_id?: string | null;
      guest_customer_name?: string | null;
      guest_queue_number?: number | null;
    };

    const orderId = rowExt.order_id ? String(rowExt.order_id) : null;
    const rawQueueId = rowExt.queue_id ? String(rowExt.queue_id) : null;
    const fromOrder = orderId ? guestByOrderId.get(orderId) : undefined;
    // order.queues?.customer_name 에 해당하는 조인 결과
    const fromQueueDirect = rawQueueId ? queueById.get(rawQueueId) : undefined;

    const guest = resolveGuestFromSources({
      queues: fromQueueDirect ?? null,
      orderCustomerName: fromOrder?.customerName,
      orderQueueNumber: fromOrder?.queueNumber,
      guestCustomerName: rowExt.guest_customer_name,
      guestQueueNumber: rowExt.guest_queue_number,
      queueId: fromOrder?.queueId ?? rawQueueId,
    });

    // fromOrder 에 이미 queues 조인 결과가 반영되어 있음 — 우선 사용
    const customerName =
      fromOrder?.customerName ||
      guest.customerName ||
      normalizePhoneTail(fromQueueDirect?.customer_name) ||
      null;
    const queueNumber =
      fromOrder?.queueNumber ??
      guest.queueNumber ??
      ((Number(fromQueueDirect?.queue_number) || 0) > 0
        ? Number(fromQueueDirect?.queue_number)
        : null);

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
      queueId: fromOrder?.queueId ?? rawQueueId,
      customerName,
      queueNumber,
    };
  });
}



/** 판매 로그를 결제(영수증) 단위로 그룹화 */
export function groupSalesByPayment(
  logs: SaleLogWithProduct[]
): SalePaymentGroup[] {
  const map = new Map<string, SalePaymentGroup>();

  for (const log of logs) {
    const key = paymentKey(log);
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
      if (!existing.customerName && log.customerName) {
        existing.customerName = log.customerName;
      }
      if (existing.queueNumber == null && log.queueNumber != null) {
        existing.queueNumber = log.queueNumber;
      }
      if (!existing.queueId && log.queueId) {
        existing.queueId = log.queueId;
      }
      if (!existing.orderId && log.orderId) {
        existing.orderId = log.orderId;
      }
    } else {
      map.set(key, {
        groupKey: key,
        paymentGroupId: log.paymentGroupId ?? null,
        orderId: log.orderId ?? null,
        queueId: log.queueId ?? null,
        customerName: log.customerName?.trim() || "",
        queueNumber: log.queueNumber ?? null,
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
      day1Sales: number;
      day2Sales: number;
      day3Sales: number;
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
      if (log.dayNumber === 1) existing.day1Sales += log.quantity;
      else if (log.dayNumber === 2) existing.day2Sales += log.quantity;
      else if (log.dayNumber === 3) existing.day3Sales += log.quantity;
    } else {
      productMap.set(log.productId, {
        productName: log.productName,
        brand: log.brand,
        companyType: log.companyType,
        quantity: log.quantity,
        revenue: log.totalPrice,
        day1Sales: log.dayNumber === 1 ? log.quantity : 0,
        day2Sales: log.dayNumber === 2 ? log.quantity : 0,
        day3Sales: log.dayNumber === 3 ? log.quantity : 0,
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
      day1Sales: value.day1Sales,
      day2Sales: value.day2Sales,
      day3Sales: value.day3Sales,
    }))
    .sort((a, b) => {
      if (b.quantity !== a.quantity) return b.quantity - a.quantity;
      return b.revenue - a.revenue;
    })
    .slice(0, 10);

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
