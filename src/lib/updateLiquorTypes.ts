import { supabase } from "@/lib/supabase";

export type LiquorTypePair = {
  name: string;
  liquorType: string;
};

export type LiquorTypeUpdateSummary = {
  total: number;
  updated: number;
  notFound: string[];
  errors: string[];
};

/** 한 줄을 상품명 + 주종으로 파싱 (탭 우선, 없으면 첫 쉼표) */
export function parseLiquorTypeLine(line: string): LiquorTypePair | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let name = "";
  let liquorType = "";

  if (trimmed.includes("\t")) {
    const parts = trimmed.split("\t");
    name = (parts[0] ?? "").trim();
    liquorType = parts.slice(1).join("\t").trim();
  } else {
    const commaIdx = trimmed.indexOf(",");
    if (commaIdx < 0) return null;
    name = trimmed.slice(0, commaIdx).trim();
    liquorType = trimmed.slice(commaIdx + 1).trim();
  }

  if (!name || !liquorType) return null;
  return { name, liquorType };
}

export function parseLiquorTypeText(text: string): LiquorTypePair[] {
  const pairs: LiquorTypePair[] = [];
  const seen = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const pair = parseLiquorTypeLine(line);
    if (!pair) continue;
    // 동일 상품명이 여러 줄이면 마지막 값 유지
    if (seen.has(pair.name)) {
      const idx = pairs.findIndex((p) => p.name === pair.name);
      if (idx >= 0) pairs[idx] = pair;
      continue;
    }
    seen.add(pair.name);
    pairs.push(pair);
  }

  return pairs;
}

/**
 * products.liquor_type만 update.
 * upsert 금지 — inventory(storage_qty 등)는 절대 건드리지 않음.
 */
export async function updateLiquorTypesFromPairs(
  pairs: LiquorTypePair[]
): Promise<LiquorTypeUpdateSummary> {
  const summary: LiquorTypeUpdateSummary = {
    total: pairs.length,
    updated: 0,
    notFound: [],
    errors: [],
  };

  for (const { name, liquorType } of pairs) {
    try {
      const { data, error } = await supabase
        .from("products")
        .update({ liquor_type: liquorType })
        .eq("name", name)
        .select("id");

      if (error) {
        summary.errors.push(`[${name}] ${error.message}`);
        continue;
      }

      if (!data || data.length === 0) {
        summary.notFound.push(name);
        continue;
      }

      summary.updated += data.length;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "알 수 없는 오류";
      summary.errors.push(`[${name}] ${message}`);
    }
  }

  return summary;
}
