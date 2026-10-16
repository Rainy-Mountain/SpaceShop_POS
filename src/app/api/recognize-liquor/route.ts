import { fetchAllRows } from "@/lib/fetchAllRows";
import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export type CatalogProduct = {
  id: string;
  name: string;
  price: number;
};

export type LiquorNotFound = {
  found: false;
};

export type LiquorFound = {
  found: true;
  matched_db_name: string;
  name: string;
  event_price: number;
  description: string;
  abv: string;
  tasting_notes: string;
  recommend_reason: string;
};

export type LiquorRecognitionResponse = LiquorNotFound | LiquorFound;

function notFound(): LiquorNotFound {
  return { found: false };
}

function parseDataUrl(raw: string): { mime: string; base64: string } | null {
  const trimmed = raw.trim();
  const dataUrl = trimmed.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/
  );
  if (dataUrl) {
    return { mime: dataUrl[1], base64: dataUrl[2].replace(/\s/g, "") };
  }
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 32) {
    return { mime: "image/jpeg", base64: trimmed.replace(/\s/g, "") };
  }
  return null;
}

function estimateBase64Bytes(base64: string) {
  return Math.floor((base64.length * 3) / 4);
}

function extractJsonObject(text: string): unknown {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(stripped.slice(start, end + 1));
    }
    throw new Error("AI 응답을 JSON으로 파싱하지 못했습니다.");
  }
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "null") return null;
  return text;
}

function buildSystemPrompt(productNames: string[]) {
  const listJson = JSON.stringify(productNames, null, 0);
  return `너는 전문 소믈리에이자 위스키/주류 식별 엔진이다.
서론, 결론, 설명, 마크다운, 코드펜스는 절대 출력하지 말고 JSON 객체 하나만 반환한다.

[DB 제품 리스트]
${listJson}

지시사항:
1) 첨부된 이미지의 라벨을 읽고, 내가 제공한 [DB 제품 리스트] 중에서 가장 정확하게 일치하는 제품 하나를 찾아내라. 영문일 경우 한글로 번역/유추해서라도 리스트 내에서 매칭해야 한다.
2) 리스트에 일치하는 제품이 없거나 술병이 아니면 {"found":false} 만 반환해라.
3) 제품이 특정되면, 해당 제품에 대한 방대한 웹 지식(한국웹, 영문웹 기준 최신 정보)을 종합하여 다음 정보를 작성해라.
4) 매칭 성공 시 응답은 반드시 아래 JSON 형식으로만 반환해라:
{
  "matched_db_name": "매칭된 DB 상의 정확한 제품명",
  "event_price": "매칭된 제품의 DB상 가격 (숫자)",
  "description": "웹 정보를 기반으로 한 1~2줄의 매력적인 설명",
  "abv": "도수 (예: 40%)",
  "tasting_notes": "향(Nose), 맛(Palate), 피니시(Finish) 요약",
  "recommend_reason": "전문가로서 이 술을 추천하는 이유"
}

추가 규칙:
- matched_db_name은 [DB 제품 리스트]에 있는 문자열과 완전히 동일해야 한다.
- event_price는 추측하지 말고, 매칭된 그 제품의 DB 가격을 숫자로만 넣어라. 리스트에 가격이 없으면 생략해도 된다.
- JSON 이외의 텍스트를 한 글자도 쓰지 마라.`;
}

async function fetchEventProducts(): Promise<CatalogProduct[]> {
  const supabase = getSupabaseServer();
  const rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase.from("products").select("id, name, price").order("id").range(from, to)
  );
  return rows.map((row) => ({ id: String(row.id), name: String(row.name ?? "").trim(), price: Number(row.price) || 0 }))
    .filter((row) => row.name);
}

function findCatalogProduct(
  catalog: CatalogProduct[],
  matchedName: string
): CatalogProduct | null {
  const needle = matchedName.trim();
  if (!needle) return null;
  const exact = catalog.find((item) => item.name === needle);
  if (exact) return exact;
  const lower = needle.toLowerCase();
  return (
    catalog.find((item) => item.name.toLowerCase() === lower) ?? null
  );
}

async function analyzeWithOpenAI(
  apiKey: string,
  systemPrompt: string,
  mime: string,
  base64: string
): Promise<string> {
  const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "이미지 라벨을 DB 제품 리스트와 대조하고 JSON만 반환해.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${mime};base64,${base64}`,
              },
            },
          ],
        },
      ],
    }),
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI Vision 요청에 실패했습니다.");
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI Vision 응답이 비어 있습니다.");
  return content;
}

async function analyzeWithGemini(
  apiKey: string,
  systemPrompt: string,
  mime: string,
  base64: string
): Promise<string> {
  const model = process.env.GEMINI_VISION_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "이미지 라벨을 DB 제품 리스트와 대조하고 JSON만 반환해." },
            { inlineData: { mimeType: mime, data: base64 } },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 700,
        responseMimeType: "application/json",
      },
    }),
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini Vision 요청에 실패했습니다.");
  }

  const content = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!content) throw new Error("Gemini Vision 응답이 비어 있습니다.");
  return content;
}

async function runVisionMatch(
  systemPrompt: string,
  mime: string,
  base64: string
): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const geminiKey =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();

  if (!openaiKey && !geminiKey) {
    throw new Error(
      "OPENAI_API_KEY 또는 GEMINI_API_KEY 환경 변수가 필요합니다."
    );
  }

  return openaiKey
    ? analyzeWithOpenAI(openaiKey, systemPrompt, mime, base64)
    : analyzeWithGemini(geminiKey as string, systemPrompt, mime, base64);
}

function toFoundResponse(
  product: CatalogProduct,
  parsed: Record<string, unknown>
): LiquorFound {
  return {
    found: true,
    matched_db_name: product.name,
    name: product.name,
    event_price: product.price,
    description: asNullableString(parsed.description) ?? "",
    abv: asNullableString(parsed.abv) ?? "",
    tasting_notes: asNullableString(parsed.tasting_notes) ?? "",
    recommend_reason: asNullableString(parsed.recommend_reason) ?? "",
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      image?: unknown;
      imageBase64?: unknown;
    };
    const rawImage =
      typeof body.image === "string"
        ? body.image
        : typeof body.imageBase64 === "string"
          ? body.imageBase64
          : "";

    const parsedImage = parseDataUrl(rawImage);
    if (!parsedImage) {
      return NextResponse.json(
        { error: "base64 이미지가 필요합니다. { image: 'data:image/...;base64,...' }" },
        { status: 400 }
      );
    }

    if (estimateBase64Bytes(parsedImage.base64) > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "이미지 용량이 너무 큽니다. 6MB 이하로 보내 주세요." },
        { status: 413 }
      );
    }

    const catalog = await fetchEventProducts();
    if (catalog.length === 0) {
      return NextResponse.json(notFound());
    }

    const systemPrompt = buildSystemPrompt(catalog.map((item) => item.name));
    const rawText = await runVisionMatch(
      systemPrompt,
      parsedImage.mime,
      parsedImage.base64
    );
    const parsed = extractJsonObject(rawText);

    if (!parsed || typeof parsed !== "object") {
      return NextResponse.json(notFound());
    }

    const record = parsed as Record<string, unknown>;
    if (record.found === false) {
      return NextResponse.json(notFound());
    }

    const matchedName =
      asNullableString(record.matched_db_name) ?? asNullableString(record.name);
    if (!matchedName) {
      return NextResponse.json(notFound());
    }

    const product = findCatalogProduct(catalog, matchedName);
    if (!product) {
      return NextResponse.json(notFound());
    }

    return NextResponse.json(toFoundResponse(product, record));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "주류 인식에 실패했습니다.";
    console.error("[recognize-liquor]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
