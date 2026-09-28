import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serverClient: SupabaseClient<any, "sck", any> | null = null;

/** API Route / Server Component용 Supabase 클라이언트 */
export function getSupabaseServer(): SupabaseClient<any, "sck", any> {
  if (serverClient) return serverClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  serverClient = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "sck" }, // 재고·주문 표 공간 (src/lib/supabase.ts 참고)
  });
  return serverClient;
}
