import type { CompanyType } from "@/types/inventory";

export type CompanyFilter = "전체" | CompanyType;

export type EventDay = 1 | 2 | 3;

/** DB/로그용 위치 값. UI에서는 진열을 사용하지 않음 */
export type StockLocation = "차량" | "창고" | "진열";

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
  /** 총 판매량 (1~3일차 합) — 하위 호환 */
  soldQty: number;
  soldDay1: number;
  soldDay2: number;
  soldDay3: number;
  /** 기초 입고 ≈ 잔여 + 총판매 */
  initialQty: number;
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
