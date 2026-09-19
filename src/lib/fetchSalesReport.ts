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

function isPlaceholderGuest(value: string): boolean {
  return (
    !value ||
    value === "현장" ||
    value === "손님" ||
    value === "현장 손님" ||
    value === "워크인"
  );
}

type GuestInfo = {
  customerName: string | null;
  queueNumber: number | null;
  queueId: string | null;
};

/** orders / queues 에서 폰 뒷자리·순번 추출 */
function resolveGuestInfo(options: {
  orderCustomerName?: string | null;
  orderQueueNumber?: number | null;
  orderQueueId?: string | null;
  queueCustomerName?: string | null;
  queueNumber?: number | null;
  queueId?: string | null;
}): GuestInfo {
  const phoneRaw =
    String(options.orderCustomerName ?? "").trim() ||
    String(options.queueCustomerName ?? "").trim();
  const customerName = isPlaceholderGuest(phoneRaw) ? null : phoneRaw;

  const queueNumber =
    (Number(options.orderQueueNumber) || 0) > 0
      ? Number(options.orderQueueNumber)
      : (Number(options.queueNumber) || 0) > 0
        ? Number(options.queueNumber)
        : null;

  const queueId =
    String(options.orderQueueId ?? "").trim() ||
    String(options.queueId ?? "").trim() ||
    null;

  return { customerName, queueNumber, queueId };
}

async function fetchGuestInfoByOrderIds(
  orderIds: string[]
): Promise<Map<string, GuestInfo>> {
  const map = new Map<string, GuestInfo>();
  if (orderIds.length === 0) return map;

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, customer_name, queue_number, queue_id, queues ( customer_name, queue_number )"
    )
    .in("id", orderIds);

  if (error) {
    const plain = await supabase
      .from("orders")
      .select("id, customer_name, queue_number, queue_id")
      .in("id", orderIds);

    for (const row of plain.data ?? []) {
      map.set(
        String(row.id),
        resolveGuestInfo({
          orderCustomerName: row.customer_name as string | null,
          orderQueueNumber: row.queue_number as number | null,
          orderQueueId: row.queue_id as string | null,
        })
      );
    }

    const linkedQueueIds = [
      ...new Set(
        [...map.values()]
          .map((g) => g.queueId)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    if (linkedQueueIds.length > 0) {
      const { data: queues } = await supabase
        .from("queues")
        .select("id, customer_name, queue_number")
        .in("id", linkedQueueIds);
      const queueById = new Map(
        (queues ?? []).map((q) => [String(q.id), q])
      );
      for (const [orderId, guest] of map) {
        if (!guest.queueId) continue;
        const q = queueById.get(guest.queueId);
        if (!q) continue;
        map.set(
          orderId,
          resolveGuestInfo({
            orderCustomerName: guest.customerName,
            orderQueueNumber: guest.queueNumber,
            orderQueueId: guest.queueId,
            queueCustomerName: q.customer_name as string | null,
            queueNumber: q.queue_number as number | null,
            queueId: guest.queueId,
          })
        );
      }
    }
    return map;
  }

  for (const row of data ?? []) {
    const queue = normalizeJoinedRelation<{
      customer_name?: string | null;
      queue_number?: number | null;
    }>(row.queues);
    map.set(
      String(row.id),
      resolveGuestInfo({
        orderCustomerName: row.customer_name as string | null,
        orderQueueNumber: row.queue_number as number | null,
        orderQueueId: row.queue_id as string | null,
        queueCustomerName: queue?.customer_name,
        queueNumber: queue?.queue_number,
        queueId: row.queue_id as string | null,
      })
    );
  }
  return map;
}

async function fetchGuestInfoByQueueIds(
  queueIds: string[]
): Promise<Map<string, GuestInfo>> {
  const map = new Map<string, GuestInfo>();
  if (queueIds.length === 0) return map;

  const { data } = await supabase
    .from("queues")
    .select("id, customer_name, queue_number")
    .in("id", queueIds);

  for (const row of data ?? []) {
    map.set(
      String(row.id),
      resolveGuestInfo({
        queueCustomerName: row.customer_name as string | null,
        queueNumber: row.queue_number as number | null,
        queueId: String(row.id),
      })
    );
  }
  return map;
}

export async function fetchSaleLogsWithProducts(
  dayNumber?: EventDay
): Promise<SaleLogWithProduct[]> {
  // sales_logs.customer_name 직접 참조 금지 — order_id / queue_id 로 손님 정보 조회
  const selectFull =
    "id, product_id, day_number, sold_from, quantity, total_price, created_at, payment_group_id, order_id, queue_id";
  const selectWithOrder =
    "id, product_id, day_number, sold_from, quantity, total_price, created_at, payment_group_id, order_id";
  const selectLegacy =
    "id, product_id, day_number, sold_from, quantity, total_price, created_at";

  let salesQuery = supabase
    .from("sales_logs")
    .select(selectFull)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (dayNumber != null) {
    salesQuery = salesQuery.eq("day_number", dayNumber);
  }

  let salesResult = await salesQuery;

  if (
    salesResult.error &&
    /queue_id|schema cache|could not find/i.test(salesResult.error.message)
  ) {
    let q = supabase
      .from("sales_logs")
      .select(selectWithOrder)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (dayNumber != null) q = q.eq("day_number", dayNumber);
    salesResult = await q;
  }

  if (
    salesResult.error &&
    /payment_group_id|order_id|schema cache|could not find/i.test(
      salesResult.error.message
    )
  ) {
    let q = supabase
      .from("sales_logs")
      .select(selectLegacy)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (dayNumber != null) q = q.eq("day_number", dayNumber);
    salesResult = await q;
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

  const rows = salesResult.data ?? [];

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
  const queueIds = [
    ...new Set(
      rows
        .map((row) => {
          const ext = row as { queue_id?: string | null };
          return ext.queue_id ? String(ext.queue_id) : "";
        })
        .filter(Boolean)
    ),
  ];

  // 항상 별도 조회로 보강 (임베드 FK 의존 X)
  const [guestByOrderId, guestByQueueId] = await Promise.all([
    fetchGuestInfoByOrderIds(orderIds),
    fetchGuestInfoByQueueIds(queueIds),
  ]);

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

  return rows.map((row) => {
    const product = productMap.get(String(row.product_id));
    const rowExt = row as {
      payment_group_id?: string | null;
      order_id?: string | null;
      queue_id?: string | null;
    };

    const orderId = rowExt.order_id ? String(rowExt.order_id) : null;
    const rawQueueId = rowExt.queue_id ? String(rowExt.queue_id) : null;

    const fromOrder = orderId ? guestByOrderId.get(orderId) : undefined;
    const fromQueue = rawQueueId
      ? guestByQueueId.get(rawQueueId)
      : undefined;

    const guest = resolveGuestInfo({
      orderCustomerName: fromOrder?.customerName,
      orderQueueNumber: fromOrder?.queueNumber,
      orderQueueId: fromOrder?.queueId ?? rawQueueId,
      queueCustomerName: fromQueue?.customerName,
      queueNumber: fromQueue?.queueNumber,
      queueId: fromQueue?.queueId ?? fromOrder?.queueId ?? rawQueueId,
    });

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
      queueId: guest.queueId,
      customerName: guest.customerName,
      queueNumber: guest.queueNumber,
    };
  });
}

function paymentGroupKey(log: SaleLogWithProduct): string {
  if (log.paymentGroupId) return `pg:${log.paymentGroupId}`;
  if (log.orderId) return `ord:${log.orderId}`;
  if (log.queueId) return `q:${log.queueId}:${log.createdAt.slice(0, 19)}`;
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
