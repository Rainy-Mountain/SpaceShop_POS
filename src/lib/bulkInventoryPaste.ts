import { supabase } from "@/lib/supabase";

export type MatchStatus = "exact" | "similar" | "new";

export type ExistingProductRef = {
  id: string;
  brand: string;
  name: string;
  price: number;
  backupQty: number;
  storageQty: number;
};

export type BulkPasteDraftRow = {
  id: string;
  selected: boolean;
  brand: string;
  name: string;
  price: number;
  backupQty: number;
  storageQty: number;
  status: MatchStatus;
  matchedProductId: string | null;
  matchedProductName: string | null;
  matchedPrice: number | null;
  priceConflict: boolean;
  /** similar: merge into matched product, or force create as new */
  resolveAs: "merge" | "create";
  parseError: string | null;
};

export type BulkApplySummary = {
  merged: number;
  inserted: number;
  skipped: number;
  errors: string[];
};

function toNumber(value: string): number {
  const cleaned = value.replace(/,/g, "").replace(/원/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function toQty(value: string): number {
  const n = toNumber(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.floor(n);
}

/** 공백·대소문자 정규화 (유사 비교용) */
export function normalizeProductName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

function splitLine(line: string): string[] {
  if (line.includes("\t")) {
    return line.split("\t").map((c) => c.trim());
  }
  if (line.includes("|")) {
    return line.split("|").map((c) => c.trim());
  }
  if (line.includes(",")) {
    return line.split(",").map((c) => c.trim());
  }
  return [line.trim()];
}

function isHeaderRow(cols: string[]): boolean {
  const joined = cols.join(" ").toLowerCase();
  return (
    joined.includes("브랜드") ||
    joined.includes("제품명") ||
    joined.includes("product") ||
    joined.includes("brand")
  );
}

export function parseBulkPasteText(raw: string): Omit<
  BulkPasteDraftRow,
  | "status"
  | "matchedProductId"
  | "matchedProductName"
  | "matchedPrice"
  | "priceConflict"
  | "resolveAs"
>[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows: Omit<
    BulkPasteDraftRow,
    | "status"
    | "matchedProductId"
    | "matchedProductName"
    | "matchedPrice"
    | "priceConflict"
    | "resolveAs"
  >[] = [];

  lines.forEach((line, index) => {
    const cols = splitLine(line).filter((c) => c.length > 0);
    if (cols.length === 0) return;
    if (index === 0 && isHeaderRow(cols)) return;

    // brand | name | price | backup | storage
    // allow name-only leading if 4 cols: name, price, backup, storage
    let brand = "";
    let name = "";
    let priceRaw = "";
    let backupRaw = "";
    let storageRaw = "";

    if (cols.length >= 5) {
      [brand, name, priceRaw, backupRaw, storageRaw] = cols;
    } else if (cols.length === 4) {
      [name, priceRaw, backupRaw, storageRaw] = cols;
      brand = "미지정";
    } else if (cols.length === 3) {
      [name, priceRaw, storageRaw] = cols;
      brand = "미지정";
      backupRaw = "0";
    } else {
      rows.push({
        id: `row-${index}-${Date.now()}`,
        selected: false,
        brand: "",
        name: cols[0] || "",
        price: 0,
        backupQty: 0,
        storageQty: 0,
        parseError: "형식이 올바르지 않습니다. (브랜드|제품명|가격|백업|매장)",
      });
      return;
    }

    const price = toNumber(priceRaw);
    const backupQty = toQty(backupRaw);
    const storageQty = toQty(storageRaw);
    const errors: string[] = [];

    if (!name.trim()) errors.push("제품명 없음");
    if (!Number.isFinite(price) || price < 0) errors.push("가격 오류");
    if (!Number.isFinite(backupQty)) errors.push("백업 수량 오류");
    if (!Number.isFinite(storageQty)) errors.push("매장 수량 오류");

    rows.push({
      id: `row-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      selected: errors.length === 0,
      brand: brand.trim() || "미지정",
      name: name.trim(),
      price: Number.isFinite(price) ? price : 0,
      backupQty: Number.isFinite(backupQty) ? backupQty : 0,
      storageQty: Number.isFinite(storageQty) ? storageQty : 0,
      parseError: errors.length ? errors.join(", ") : null,
    });
  });

  return rows;
}

function findBestMatch(
  name: string,
  products: ExistingProductRef[]
): {
  status: MatchStatus;
  matched: ExistingProductRef | null;
} {
  const trimmed = name.trim();
  if (!trimmed) return { status: "new", matched: null };

  const exact = products.find((p) => p.name === trimmed);
  if (exact) return { status: "exact", matched: exact };

  const normalized = normalizeProductName(trimmed);
  const spaceOnly = products.find(
    (p) =>
      p.name !== trimmed && normalizeProductName(p.name) === normalized
  );
  if (spaceOnly) return { status: "similar", matched: spaceOnly };

  // partial: one name contains the other (min length to reduce noise)
  if (normalized.length >= 2) {
    let best: ExistingProductRef | null = null;
    let bestScore = 0;

    for (const p of products) {
      const pn = normalizeProductName(p.name);
      if (pn.length < 2) continue;
      if (pn.includes(normalized) || normalized.includes(pn)) {
        const score = Math.min(pn.length, normalized.length);
        if (score > bestScore) {
          bestScore = score;
          best = p;
        }
      }
    }

    if (best) return { status: "similar", matched: best };
  }

  return { status: "new", matched: null };
}

export function annotateDraftRows(
  drafts: ReturnType<typeof parseBulkPasteText>,
  products: ExistingProductRef[]
): BulkPasteDraftRow[] {
  return drafts.map((row) => {
    if (row.parseError) {
      return {
        ...row,
        status: "new" as const,
        matchedProductId: null,
        matchedProductName: null,
        matchedPrice: null,
        priceConflict: false,
        resolveAs: "create" as const,
        selected: false,
      };
    }

    const { status, matched } = findBestMatch(row.name, products);
    const priceConflict =
      matched != null &&
      Number.isFinite(matched.price) &&
      matched.price !== row.price;

    return {
      ...row,
      status,
      matchedProductId: matched?.id ?? null,
      matchedProductName: matched?.name ?? null,
      matchedPrice: matched?.price ?? null,
      priceConflict,
      resolveAs: status === "new" ? ("create" as const) : ("merge" as const),
      selected: true,
    };
  });
}

export function rematchDraftRow(
  row: BulkPasteDraftRow,
  products: ExistingProductRef[]
): BulkPasteDraftRow {
  const { status, matched } = findBestMatch(row.name, products);
  const priceConflict =
    matched != null &&
    Number.isFinite(matched.price) &&
    matched.price !== row.price;

  return {
    ...row,
    status,
    matchedProductId: matched?.id ?? null,
    matchedProductName: matched?.name ?? null,
    matchedPrice: matched?.price ?? null,
    priceConflict,
    resolveAs:
      status === "new"
        ? "create"
        : row.resolveAs === "create" && status === "similar"
          ? "create"
          : "merge",
  };
}

export async function fetchExistingProductsForMatch(): Promise<
  ExistingProductRef[]
> {
  const { data, error } = await supabase
    .from("products")
    .select("id, brand, name, price, inventory(backup_qty, storage_qty)");

  if (error) throw new Error(error.message || "제품 목록을 불러오지 못했습니다.");

  return (data ?? []).map((p) => {
    const invRaw = p.inventory;
    const inv = Array.isArray(invRaw) ? invRaw[0] : invRaw;
    return {
      id: String(p.id),
      brand: String(p.brand ?? ""),
      name: String(p.name ?? ""),
      price: Number(p.price) || 0,
      backupQty: Number(inv?.backup_qty) || 0,
      storageQty: Number(inv?.storage_qty) || 0,
    };
  });
}

async function addInventoryQty(
  productId: string, addBackup: number, addStorage: number
): Promise<void> {
  const { error } = await supabase.rpc("add_inventory", {
    p_product_id: productId, p_backup: addBackup, p_storage: addStorage,
  });
  if (error) throw new Error(error.message);
}

export async function applyBulkPasteRows(
  rows: BulkPasteDraftRow[],
  options?: { overwritePrice?: boolean }
): Promise<BulkApplySummary> {
  const overwritePrice = options?.overwritePrice ?? true;
  const summary: BulkApplySummary = {
    merged: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
  };

  const selected = rows.filter((r) => r.selected && !r.parseError);

  for (const row of selected) {
    const label = row.name || "(이름 없음)";
    try {
      const shouldMerge =
        row.resolveAs === "merge" &&
        row.matchedProductId &&
        (row.status === "exact" || row.status === "similar");

      if (shouldMerge) {
        const productId = row.matchedProductId!;

        if (overwritePrice && row.priceConflict) {
          const { error: priceError } = await supabase
            .from("products")
            .update({ price: row.price })
            .eq("id", productId);
          if (priceError) throw new Error(priceError.message);
        }

        if (row.brand && row.brand !== "미지정") {
          await supabase
            .from("products")
            .update({ brand: row.brand })
            .eq("id", productId);
        }

        await addInventoryQty(productId, row.backupQty, row.storageQty);
        summary.merged += 1;
      } else {
        const { data: created, error: insertError } = await supabase
          .from("products")
          .insert({
            brand: row.brand || "미지정",
            name: row.name.trim(),
            company_type: "자사",
            price: row.price,
          })
          .select("id")
          .single();

        if (insertError) throw new Error(insertError.message);
        if (!created?.id) throw new Error("제품 등록 실패");

        await addInventoryQty(created.id, row.backupQty, row.storageQty);
        summary.inserted += 1;
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "알 수 없는 오류";
      summary.errors.push(`[${label}] ${message}`);
      summary.skipped += 1;
    }
  }

  return summary;
}
