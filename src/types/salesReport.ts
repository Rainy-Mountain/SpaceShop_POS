import type { StockLocation } from "@/types/dashboard";

export interface SaleLogWithProduct {
  id: string;
  productId: string;
  dayNumber: number;
  soldFrom: StockLocation;
  quantity: number;
  totalPrice: number;
  createdAt: string;
  productName: string;
  brand: string;
  companyType: string;
  unitPrice: number;
  paymentGroupId?: string | null;
  orderId?: string | null;
  queueId?: string | null;
  /** 폰 뒷자리 4자리 */
  customerName?: string | null;
  /** 대기 순번 */
  queueNumber?: number | null;
}

export interface SalePaymentGroupItem {
  saleId: string;
  productId: string;
  productName: string;
  brand: string;
  quantity: number;
  totalPrice: number;
}

/** 영수증(결제 건) 단위 그룹 */
export interface SalePaymentGroup {
  groupKey: string;
  paymentGroupId: string | null;
  orderId: string | null;
  queueId: string | null;
  /** 폰 뒷자리 4자리 (없으면 빈 문자열) */
  customerName: string;
  /** 대기 순번 (없으면 null) */
  queueNumber: number | null;
  createdAt: string;
  dayNumber: number;
  items: SalePaymentGroupItem[];
  totalPrice: number;
  saleIds: string[];
}

export interface DaySalesStat {
  dayNumber: 1 | 2 | 3;
  quantity: number;
  revenue: number;
}

export interface ProductSalesRank {
  productId: string;
  productName: string;
  brand: string;
  companyType: string;
  quantity: number;
  revenue: number;
  day1Sales: number;
  day2Sales: number;
  day3Sales: number;
}

export interface SalesReportSummary {
  totalRevenue: number;
  totalQuantity: number;
  ownRevenue: number;
  otherRevenue: number;
  byDay: DaySalesStat[];
  ranking: ProductSalesRank[];
}
