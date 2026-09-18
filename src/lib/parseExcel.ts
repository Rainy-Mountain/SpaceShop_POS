import * as XLSX from "xlsx";
import type { CompanyType, ExcelProductRow } from "@/types/inventory";

type CellValue = string | number | boolean | Date | null | undefined;
type SheetMatrix = CellValue[][];

interface ProductInfo {
  brand: string;
  name: string;
  companyType: CompanyType;
  price: number;
}

interface InventoryInfo {
  name: string;
  backupQty: number;
  storageQty: number;
  displayQty: number;
}

/** 헤더 비교용: 공백·괄호 제거 */
function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）\[\]【】._\-]/g, "");
}

/** 시트명 비교용: 공백만 제거 */
function compactSheetName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** 모든 문자열은 trim 후 사용 */
function toText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function hasCellValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return toText(value) !== "";
}

function extractNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = toText(value);
  if (!text) return 0;

  const matched = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!matched) return 0;

  const parsed = Number(matched[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 셀 스타일(배경색 등)은 무시하고 값만 추출
 * raw:false → 표시 문자열, blankrows:false → 완전 빈 행 제외
 */
function sheetToMatrix(sheet: XLSX.WorkSheet): SheetMatrix {
  return XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });
}

function findHeaderRowIndex(rows: SheetMatrix): number {
  const limit = Math.min(rows.length, 20);

  for (let i = 0; i < limit; i += 1) {
    const hasProductName = (rows[i] ?? []).some(
      (cell) => normalizeKey(cell) === "제품명"
    );
    if (hasProductName) return i;
  }

  return -1;
}

function findExactColumn(headers: string[], aliases: string[]): number {
  const targets = aliases.map(normalizeKey);
  return headers.findIndex((header) => targets.includes(header));
}

function findColumnContaining(headers: string[], keywords: string[]): number {
  for (const keyword of keywords) {
    const target = normalizeKey(keyword);
    const index = headers.findIndex((header) => header.includes(target));
    if (index >= 0) return index;
  }
  return -1;
}

/** 재고는 '재고확인용' 포함 시트에서만 */
function isInventorySheet(sheetName: string): boolean {
  return compactSheetName(sheetName).includes("재고확인용");
}

/**
 * 제품 기본정보 시트만 인식 (재고는 여기서 읽지 않음)
 * - 스컴 손님 체크용 / 스컴할인제품 / 스컴할인제외제품 → 자사
 * - 타사제품 손님 체크용 / 타사제품 → 타사
 */
function resolveProductCompanyType(sheetName: string): CompanyType | null {
  const compact = compactSheetName(sheetName);

  // 재고 시트는 제품 소스로 쓰지 않음
  if (compact.includes("재고확인용")) return null;

  // 손님 체크용
  if (compact.includes("손님체크용")) {
    if (compact.includes("타사")) return "타사";
    if (compact.includes("스컴")) return "자사";
  }

  // 스컴할인제품 / 스컴할인제외제품
  if (
    compact.includes("스컴할인제품") ||
    compact.includes("스컴할인제외제품")
  ) {
    return "자사";
  }

  // 타사제품 (타사제품손님체크용은 위에서 처리됨)
  if (compact === "타사제품" || compact.startsWith("타사제품")) {
    // '타사제품재고...' 같은 이름은 재고확인용이 아니면 타사 제품 시트로 간주
    if (!compact.includes("재고")) return "타사";
  }

  return null;
}

function parseProductSheet(
  sheet: XLSX.WorkSheet,
  companyType: CompanyType
): ProductInfo[] {
  const rows = sheetToMatrix(sheet);
  const headerIndex = findHeaderRowIndex(rows);
  if (headerIndex < 0) return [];

  const headers = (rows[headerIndex] ?? []).map((cell) => normalizeKey(cell));

  const nameIdx = findExactColumn(headers, ["제품명", "name"]);
  if (nameIdx < 0) return [];

  const brandIdx = findExactColumn(headers, ["브랜드명", "브랜드", "brand"]);
  // 브랜드 열이 없으면 이 시트는 스킵 (미지정 생성 방지)
  if (brandIdx < 0) return [];

  const discountPriceIdx = findExactColumn(headers, [
    "할인특가",
    "할인 특가",
    "특가",
  ]);
  const normalPriceIdx = findExactColumn(headers, [
    "샵정상판매가",
    "샵 정상 판매가",
    "정상판매가",
    "판매가",
  ]);

  const products: ProductInfo[] = [];

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const name = toText(row[nameIdx]);
    const brand = toText(row[brandIdx]);

    // 제품명 또는 브랜드명이 비어 있으면 완전 무시
    if (!name || !brand) continue;

    let price = 0;
    if (discountPriceIdx >= 0 && hasCellValue(row[discountPriceIdx])) {
      price = extractNumber(row[discountPriceIdx]);
    } else if (normalPriceIdx >= 0) {
      price = extractNumber(row[normalPriceIdx]);
    }

    products.push({
      brand,
      name,
      companyType,
      price,
    });
  }

  // trim된 제품명 기준 중복 제거 (마지막 값 우선)
  const byName = new Map<string, ProductInfo>();
  for (const product of products) {
    byName.set(product.name, product);
  }

  return Array.from(byName.values());
}

function resolveStorageColumnIndex(headers: string[]): number {
  const primary = findColumnContaining(headers, ["기존재고"]);
  if (primary >= 0) return primary;

  const secondary = findColumnContaining(headers, [
    "재고현황",
    "현재고",
    "현재재고",
  ]);
  if (secondary >= 0) return secondary;

  return findColumnContaining(headers, ["창고재고", "샵재고"]);
}

function resolveBackupColumnIndex(headers: string[]): number {
  return findColumnContaining(headers, [
    "스페어주류차량",
    "스페어주류",
    "스페어",
  ]);
}

function parseInventorySheet(sheet: XLSX.WorkSheet): InventoryInfo[] {
  try {
    const rows = sheetToMatrix(sheet);
    const headerIndex = findHeaderRowIndex(rows);
    if (headerIndex < 0) return [];

    const headers = (rows[headerIndex] ?? []).map((cell) => normalizeKey(cell));

    const nameIdx = findExactColumn(headers, ["제품명", "name"]);
    if (nameIdx < 0) return [];

    const storageIdx = resolveStorageColumnIndex(headers);
    const backupIdx = resolveBackupColumnIndex(headers);

    const items: InventoryInfo[] = [];

    for (let i = headerIndex + 1; i < rows.length; i += 1) {
      try {
        const row = rows[i] ?? [];
        const name = toText(row[nameIdx]);
        // 제품명 없는 빈 행은 무시
        if (!name) continue;

        items.push({
          name,
          storageQty: storageIdx >= 0 ? extractNumber(row[storageIdx]) : 0,
          backupQty: backupIdx >= 0 ? extractNumber(row[backupIdx]) : 0,
          displayQty: 0,
        });
      } catch {
        continue;
      }
    }

    const byName = new Map<string, InventoryInfo>();
    for (const item of items) {
      const prev = byName.get(item.name);
      if (!prev) {
        byName.set(item.name, item);
        continue;
      }

      byName.set(item.name, {
        name: item.name,
        backupQty: (prev.backupQty || 0) + (item.backupQty || 0),
        storageQty: (prev.storageQty || 0) + (item.storageQty || 0),
        displayQty: 0,
      });
    }

    return Array.from(byName.values());
  } catch {
    return [];
  }
}

function findInventoryForProduct(
  inventoryByName: Map<string, InventoryInfo>,
  productName: string
): InventoryInfo | undefined {
  const trimmed = productName.trim();
  const exact = inventoryByName.get(trimmed);
  if (exact) return exact;

  const compactName = compactSheetName(trimmed);
  for (const [name, info] of inventoryByName.entries()) {
    if (compactSheetName(name) === compactName) return info;
  }

  return undefined;
}

/**
 * 제품 시트 기준으로만 병합.
 * 재고만 있고 제품 정보가 없는 항목은 업로드하지 않음 → '브랜드 미지정' 방지
 */
function mergeProductsAndInventory(
  products: ProductInfo[],
  inventories: InventoryInfo[]
): ExcelProductRow[] {
  const inventoryByName = new Map(
    inventories.map((item) => [item.name.trim(), item] as const)
  );
  const merged = new Map<string, ExcelProductRow>();

  for (const product of products) {
    const name = product.name.trim();
    const brand = product.brand.trim();

    // 방어: 빈 브랜드/제품명 재확인
    if (!name || !brand) continue;

    const inventory = findInventoryForProduct(inventoryByName, name);

    merged.set(name, {
      brand,
      name,
      companyType: product.companyType,
      price: Number.isFinite(product.price) ? product.price : 0,
      backupQty: inventory?.backupQty ?? 0,
      storageQty: inventory?.storageQty ?? 0,
      displayQty: 0,
    });
  }

  return Array.from(merged.values());
}

export async function parseExcelFile(file: File): Promise<ExcelProductRow[]> {
  const buffer = await file.arrayBuffer();
  // cellStyles 없이 값만 읽음 (배경색 하이라이트 무시)
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellStyles: false,
    cellHTML: false,
  });

  if (!workbook.SheetNames.length) {
    throw new Error("엑셀 파일에 시트가 없습니다.");
  }

  const products: ProductInfo[] = [];
  const inventories: InventoryInfo[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    try {
      // 1) 재고확인용 시트만 재고 파싱
      if (isInventorySheet(sheetName)) {
        inventories.push(...parseInventorySheet(sheet));
        continue;
      }

      // 2) 제품 정보 시트만 브랜드/이름/가격 파싱 (재고 수량 절대 미사용)
      const companyType = resolveProductCompanyType(sheetName);
      if (companyType) {
        products.push(...parseProductSheet(sheet, companyType));
      }
    } catch {
      continue;
    }
  }

  const merged = mergeProductsAndInventory(products, inventories);

  if (merged.length === 0) {
    throw new Error(
      "파싱된 제품이 없습니다. '스컴 손님 체크용'/'스컴할인*'/'타사제품' 및 '재고확인용*' 시트를 확인해 주세요."
    );
  }

  return merged;
}
