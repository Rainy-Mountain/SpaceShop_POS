import { supabase } from "@/lib/supabase";
import type {
  ExcelProductRow,
  UploadProgress,
  UploadSummary,
} from "@/types/inventory";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    error &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "알 수 없는 오류가 발생했습니다.";
}

/**
 * inventory PK = product_id
 * 재고값이 0이어도 무조건 insert/upsert
 */
async function upsertInventory(
  productId: string,
  row: ExcelProductRow
): Promise<void> {
  const payload = {
    product_id: productId,
    backup_qty: Number.isFinite(row.backupQty) ? row.backupQty : 0,
    storage_qty: Number.isFinite(row.storageQty) ? row.storageQty : 0,
    display_qty: Number.isFinite(row.displayQty) ? row.displayQty : 0,
    last_updated: new Date().toISOString(),
  };

  const { error } = await supabase.from("inventory").upsert(payload, {
    onConflict: "product_id",
  });

  if (error) throw error;
}

export async function uploadExcelRows(
  rows: ExcelProductRow[],
  onProgress?: (progress: UploadProgress) => void
): Promise<UploadSummary> {
  const summary: UploadSummary = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    total: rows.length,
  };

  const total = rows.length;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const current = index + 1;
    const name = (row.name || "").trim() || "이름 없음";

    onProgress?.({
      current,
      total,
      productName: name,
      status: "processing",
    });

    // UI가 매 건마다 다시 그려지도록 이벤트 루프에 양보
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    try {
      if (!row.name?.trim()) {
        summary.skipped += 1;
        onProgress?.({
          current,
          total,
          productName: name,
          status: "error",
          message: "제품명이 비어 있어 건너뜀",
        });
        continue;
      }

      const productPayload = {
        brand: row.brand?.trim() || "",
        name: row.name.trim(),
        company_type: row.companyType || "자사",
        price: Number.isFinite(row.price) ? row.price : 0,
      };

      if (!productPayload.name || !productPayload.brand) {
        summary.skipped += 1;
        onProgress?.({
          current,
          total,
          productName: name,
          status: "error",
          message: "제품명 또는 브랜드명이 비어 있어 건너뜀",
        });
        continue;
      }

      const { data: existingProduct, error: findError } = await supabase
        .from("products")
        .select("id")
        .eq("name", productPayload.name)
        .maybeSingle();

      if (findError) throw findError;

      let productId = existingProduct?.id as string | undefined;
      const isUpdate = Boolean(productId);

      if (productId) {
        const { error: updateError } = await supabase
          .from("products")
          .update(productPayload)
          .eq("id", productId);

        if (updateError) throw updateError;
      } else {
        const { data: created, error: insertError } = await supabase
          .from("products")
          .insert(productPayload)
          .select("id")
          .single();

        if (insertError) throw insertError;
        productId = created.id;
      }

      // 재고 0이어도 반드시 upsert
      await upsertInventory(productId!, {
        ...row,
        backupQty: Number.isFinite(row.backupQty) ? row.backupQty : 0,
        storageQty: Number.isFinite(row.storageQty) ? row.storageQty : 0,
        displayQty: Number.isFinite(row.displayQty) ? row.displayQty : 0,
      });

      if (isUpdate) summary.updated += 1;
      else summary.inserted += 1;

      onProgress?.({
        current,
        total,
        productName: name,
        status: "success",
      });
    } catch (error) {
      const message = getErrorMessage(error);
      summary.errors.push(`[${name}] ${message}`);
      summary.skipped += 1;

      onProgress?.({
        current,
        total,
        productName: name,
        status: "error",
        message,
      });
    }
  }

  return summary;
}

export type ManualProductInput = {
  name: string;
  price: number;
  storageQty: number;
  backupQty: number;
};

/** 단일 품목 수동 등록 — products INSERT + inventory UPSERT */
export async function createManualProduct(
  input: ManualProductInput
): Promise<{ productId: string }> {
  const name = input.name.trim();
  if (!name) throw new Error("제품명을 입력해 주세요.");

  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("판매 가격은 0 이상의 숫자여야 합니다.");
  }

  const storageQty = Number.isFinite(input.storageQty)
    ? Math.max(0, Math.floor(input.storageQty))
    : 0;
  const backupQty = Number.isFinite(input.backupQty)
    ? Math.max(0, Math.floor(input.backupQty))
    : 0;

  const { data: existing, error: findError } = await supabase
    .from("products")
    .select("id")
    .eq("name", name)
    .maybeSingle();

  if (findError) throw new Error(findError.message);
  if (existing?.id) {
    throw new Error("이미 같은 제품명이 등록되어 있습니다.");
  }

  const { data: created, error: insertError } = await supabase
    .from("products")
    .insert({
      brand: "미지정",
      name,
      company_type: "자사",
      price,
    })
    .select("id")
    .single();

  if (insertError) throw new Error(insertError.message || "제품 등록 실패");
  if (!created?.id) throw new Error("제품 등록에 실패했습니다.");

  await upsertInventory(created.id, {
    brand: "미지정",
    name,
    companyType: "자사",
    price,
    backupQty,
    storageQty,
    displayQty: 0,
  });

  return { productId: String(created.id) };
}
