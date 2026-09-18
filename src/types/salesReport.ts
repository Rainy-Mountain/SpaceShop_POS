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
