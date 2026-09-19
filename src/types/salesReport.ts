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
  customerName?: string | null;
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
  customerName: string;
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
}

export interface SalesReportSummary {
  totalRevenue: number;
  totalQuantity: number;
  ownRevenue: number;
  otherRevenue: number;
  byDay: DaySalesStat[];
  ranking: ProductSalesRank[];
}
