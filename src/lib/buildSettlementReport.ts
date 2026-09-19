import { fetchSaleLogsWithProducts } from "@/lib/fetchSalesReport";
import type { EventDay } from "@/types/dashboard";
import type { SaleLogWithProduct } from "@/types/salesReport";

export type SettlementScope = "today" | "all";

export type SettlementLineItem = {
  productId: string;
  productName: string;
  brand: string;
  quantity: number;
  revenue: number;
  day1Sales: number;
  day2Sales: number;
  day3Sales: number;
};

export type SettlementReportData = {
  scope: SettlementScope;
  title: string;
  generatedAtLabel: string;
  periodLabel: string;
  totalRevenue: number;
  paymentCount: number;
  totalQuantity: number;
  bestsellers: SettlementLineItem[];
  details: SettlementLineItem[];
};

function formatGeneratedAt(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}.${m}.${d} ${hh}:${mm}`;
}

/** 동일 시각(초 단위) 배치 INSERT를 한 결제 건으로 집계 */
function countPayments(logs: SaleLogWithProduct[]): number {
  const keys = new Set<string>();
  for (const log of logs) {
    const t = new Date(log.createdAt);
    if (Number.isNaN(t.getTime())) {
      keys.add(log.id);
      continue;
    }
    keys.add(
      `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}-${t.getHours()}-${t.getMinutes()}-${t.getSeconds()}`
    );
  }
  return keys.size;
}

function aggregateLines(logs: SaleLogWithProduct[]): SettlementLineItem[] {
  const map = new Map<string, SettlementLineItem>();

  for (const log of logs) {
    const existing = map.get(log.productId);
    if (existing) {
      existing.quantity += log.quantity;
      existing.revenue += log.totalPrice;
      if (log.dayNumber === 1) existing.day1Sales += log.quantity;
      else if (log.dayNumber === 2) existing.day2Sales += log.quantity;
      else if (log.dayNumber === 3) existing.day3Sales += log.quantity;
    } else {
      map.set(log.productId, {
        productId: log.productId,
        productName: log.productName,
        brand: log.brand,
        quantity: log.quantity,
        revenue: log.totalPrice,
        day1Sales: log.dayNumber === 1 ? log.quantity : 0,
        day2Sales: log.dayNumber === 2 ? log.quantity : 0,
        day3Sales: log.dayNumber === 3 ? log.quantity : 0,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.quantity !== a.quantity) return b.quantity - a.quantity;
    return b.revenue - a.revenue;
  });
}

export async function buildSettlementReport(
  scope: SettlementScope,
  eventDay: EventDay
): Promise<SettlementReportData> {
  const allLogs = await fetchSaleLogsWithProducts();

  // KPI는 scope에 따라, 상세 테이블은 항상 1~3일차 피벗 (전체 로그 기준)
  const kpiLogs =
    scope === "today"
      ? allLogs.filter((log) => log.dayNumber === eventDay)
      : allLogs;

  const details = aggregateLines(allLogs).slice(0, 10);
  const bestsellers = aggregateLines(kpiLogs).slice(0, 5);
  const totalRevenue = kpiLogs.reduce((sum, log) => sum + log.totalPrice, 0);
  const totalQuantity = kpiLogs.reduce((sum, log) => sum + log.quantity, 0);
  const paymentCount = countPayments(kpiLogs);

  return {
    scope,
    title:
      scope === "today"
        ? "행사 정산 리포트 (금일)"
        : "행사 정산 리포트 (전체)",
    generatedAtLabel: formatGeneratedAt(),
    periodLabel: scope === "today" ? `${eventDay}일차` : "1~3일차 전체",
    totalRevenue,
    paymentCount,
    totalQuantity,
    bestsellers,
    details,
  };
}
