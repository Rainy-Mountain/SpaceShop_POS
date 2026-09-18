export type CompanyType = "자사" | "타사";

export interface ExcelProductRow {
  brand: string;
  name: string;
  companyType: CompanyType;
  price: number;
  backupQty: number;
  storageQty: number;
  displayQty: number;
}

export interface UploadProgress {
  current: number;
  total: number;
  productName: string;
  status: "processing" | "success" | "error";
  message?: string;
}

export interface UploadLogItem {
  key: string;
  index: number;
  productName: string;
  status: "success" | "error";
  message?: string;
}

export interface UploadSummary {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  total: number;
}

export interface Product {
  id: string;
  brand: string;
  name: string;
  company_type: string;
  price: number;
}

export interface Inventory {
  product_id: string;
  backup_qty: number;
  storage_qty: number;
  display_qty: number;
}
