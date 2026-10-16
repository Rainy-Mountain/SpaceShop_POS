import { supabase } from "@/lib/supabase";

export async function registerQueue(phoneTail: string, clientToken: string): Promise<string> {
  if (!/^\d{4}$/.test(phoneTail)) throw new Error("핸드폰 번호 뒷자리 4자리를 입력해 주세요.");
  const { data, error } = await supabase.rpc("register_queue", {
    p_phone_tail: phoneTail, p_client_token: clientToken,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== "string") throw new Error("대기열 등록 결과를 확인하지 못했습니다.");
  return data;
}

export function queueClientToken(phoneTail: string, storage: Pick<Storage, "getItem" | "setItem">) {
  const key = `spaceshop:queue-client:${phoneTail}`;
  const stored = storage.getItem(key);
  if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored)) return stored;
  const token = crypto.randomUUID();
  storage.setItem(key, token);
  return token;
}
