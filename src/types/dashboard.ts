import type { CompanyType } from "@/types/inventory";

export type CompanyFilter = "전체" | CompanyType;

export type EventDay = 1 | 2 | 3;

/** DB/로그용 위치 값. UI에서는 진열을 사용하지 않음 */
export type StockLocation = "차량" | "창고" | "진열";

export type InventoryQtyField =
  | "backup_qty"
  | "storage_qty"
  | "display_qty";

export interface InventoryRecord {
  product_id: string;
  backup_qty: number | null;
  storage_qty: number | null;
  display_qty: number | null;
}

export interface ProductWithInventory {
  id: string;
  brand: string;
  name: string;
  company_type: string;
  price: number | string | null;
  liquor_type?: string | null;
  inventory: InventoryRecord | InventoryRecord[] | null;
}

export interface DashboardRow {
  id: string;
  brand: string;
  name: string;
  companyType: string;
  price: number;
  liquorType: string;
  storageQty: number;
  backupQty: number;
  totalQty: number;
  soldQty: number;
}

export interface SaleLogItem {
  id: string;
  type: "sale";
  productId: string;
  productName: string;
  brand: string;
  dayNumber: number;
  soldFrom: StockLocation;
  quantity: number;
  totalPrice: number;
  createdAt: string;
}

export interface MovementLogItem {
  id: string;
  type: "movement";
  productId: string;
  productName: string;
  brand: string;
  fromLocation: StockLocation;
  toLocation: StockLocation;
  quantity: number;
  createdAt: string;
}

export type RecentActivityItem = SaleLogItem | MovementLogItem;

/** UI에서 선택 가능한 위치 (진열 제외) */
export const UI_STOCK_LOCATIONS: Array<"차량" | "창고"> = ["창고", "차량"];

export const LOCATION_LABELS: Record<StockLocation, string> = {
  창고: "샵",
  차량: "차량 백업",
  진열: "진열",
};

export const LOCATION_TO_FIELD: Record<StockLocation, InventoryQtyField> = {
  차량: "backup_qty",
  창고: "storage_qty",
  진열: "display_qty",
};

export function getRemainingEventDays(day: EventDay): number {
  return 4 - day;
}

export function getRecommendedSales(totalQty: number, day: EventDay): number {
  const remainingDays = getRemainingEventDays(day);
  if (remainingDays <= 0) return 0;
  return Math.round(totalQty / remainingDays);
}

/** 브랜드 정렬: 한글 → 영문 → 숫자/기타 */
export function sortBrands(brands: string[]): string[] {
  const getGroup = (brand: string): number => {
    const first = brand.trim().charAt(0);
    if (!first) return 2;
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(first)) return 0;
    if (/[A-Za-z]/.test(first)) return 1;
    return 2;
  };

  return [...brands].sort((a, b) => {
    const groupA = getGroup(a);
    const groupB = getGroup(b);
    if (groupA !== groupB) return groupA - groupB;

    if (groupA === 0) return a.localeCompare(b, "ko-KR");
    if (groupA === 1) return a.localeCompare(b, "en", { sensitivity: "base" });
    return a.localeCompare(b, "ko-KR", { numeric: true });
  });
}
