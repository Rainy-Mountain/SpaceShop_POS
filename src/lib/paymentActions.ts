import { supabase } from "@/lib/supabase";
import type { StockLocation } from "@/types/dashboard";

export type SaleItem = {
  productId: string;
  quantity: number;
  unitPrice?: number;
  soldFrom: StockLocation;
};

export function normalizeSaleItems(items: SaleItem[]) {
  if (items.length === 0) throw new Error("결제할 상품이 없습니다.");
  const merged = new Map<string, {
    product_id: string; quantity: number; sold_from: StockLocation; unit_price: number | null;
  }>();
  for (const item of items) {
    if (!item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("상품과 판매 수량을 확인해 주세요.");
    }
    if (!["차량", "창고", "진열"].includes(item.soldFrom)) {
      throw new Error("잘못된 재고 위치입니다.");
    }
    if (item.unitPrice != null && (!Number.isFinite(item.unitPrice) || item.unitPrice < 0)) {
      throw new Error("판매 가격은 0 이상의 숫자여야 합니다.");
    }
    const key = `${item.productId}:${item.soldFrom}`;
    const existing = merged.get(key);
    if (existing) {
      if (existing.unit_price !== (item.unitPrice ?? null)) {
        throw new Error("동일 상품의 가격이 서로 다릅니다.");
      }
      existing.quantity += item.quantity;
      if (!Number.isSafeInteger(existing.quantity)) throw new Error("판매 수량이 너무 큽니다.");
    } else {
      merged.set(key, {
        product_id: item.productId, quantity: item.quantity,
        sold_from: item.soldFrom, unit_price: item.unitPrice ?? null,
      });
    }
  }
  return [...merged.values()].sort((a, b) =>
    a.product_id.localeCompare(b.product_id) || a.sold_from.localeCompare(b.sold_from)
  );
}

/** 같은 장바구니의 재시도에는 같은 ID를 사용하고, 성공한 뒤에만 초기화한다. */
export function paymentAttempt(
  previous: { fingerprint: string; id: string } | null,
  fingerprint: string,
  createId = () => crypto.randomUUID()
) {
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, id: createId() };
}

/** 응답 유실 후 새로고침해도 같은 요청은 같은 결제 ID로 확인한다. */
export function savedPaymentAttempt(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  fingerprint: string
) {
  let previous: { fingerprint: string; id: string } | null = null;
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "null") as unknown;
    if (parsed && typeof parsed === "object" && "fingerprint" in parsed && "id" in parsed &&
      typeof parsed.fingerprint === "string" && typeof parsed.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)) {
      previous = { fingerprint: parsed.fingerprint, id: parsed.id };
    }
  } catch {
    // 손상된 저장 데이터만 버린다. 저장 자체가 불가능하면 결제 전에 실패시킨다.
  }
  const attempt = paymentAttempt(previous, fingerprint);
  storage.setItem(key, JSON.stringify(attempt));
  return attempt;
}

export async function completeSale(options: {
  paymentId: string;
  dayNumber: number;
  items?: SaleItem[];
  orderId?: string;
}): Promise<void> {
  if (![1, 2, 3].includes(options.dayNumber)) throw new Error("행사 일차를 확인해 주세요.");
  const { error } = await supabase.rpc("complete_sale", {
    p_payment_id: options.paymentId,
    p_day_number: options.dayNumber,
    p_items: options.items ? normalizeSaleItems(options.items) : null,
    p_order_id: options.orderId ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function voidSales(saleIds: string[]): Promise<void> {
  const ids = [...new Set(saleIds.filter(Boolean))];
  if (ids.length === 0) throw new Error("취소할 판매 내역이 없습니다.");
  const { error } = await supabase.rpc("void_sales", { p_sale_ids: ids });
  if (error) throw new Error(error.message);
}
