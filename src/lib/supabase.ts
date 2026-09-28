import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient<any, "sck", any> | null = null;

/**
 * 브라우저에서만 Supabase 클라이언트를 생성한다.
 * 모듈 import / Vercel 빌드 시점에는 네트워크를 열지 않는다.
 */
export function getSupabase(): SupabaseClient<any, "sck", any> {
  if (typeof window === "undefined") {
    throw new Error(
      "Supabase client is browser-only. Call it inside useEffect or event handlers."
    );
  }

  if (browserClient) return browserClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  // 재고·주문 표는 Supabase의 sck 공간에 있다 (같은 프로젝트의 TASTEMARK와 분리, 2026-09-29)
  browserClient = createClient(supabaseUrl, supabaseAnonKey, { db: { schema: "sck" } });
  return browserClient;
}

/** 지연 생성 프록시 — import만으로 createClient가 호출되지 않음 */
export const supabase: SupabaseClient<any, "sck", any> = new Proxy({} as SupabaseClient<any, "sck", any>, {
  get(_target, prop, receiver) {
    const client = getSupabase();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});
