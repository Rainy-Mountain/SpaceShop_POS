import { supabase } from "@/lib/supabase";

export type StoreSettings = {
  autoEnter: boolean;
  updatedAt: string | null;
};

const SETTINGS_ID = 1;

/** 현장 설정 1행 조회 (없으면 기본값) */
export async function fetchStoreSettings(): Promise<StoreSettings> {
  const { data, error } = await supabase
    .from("store_settings")
    .select("auto_enter, updated_at")
    .eq("id", SETTINGS_ID)
    .maybeSingle();

  if (error) {
    // 테이블 미생성 환경 — 기본 OFF
    if (/schema cache|does not exist|could not find/i.test(error.message)) {
      return { autoEnter: false, updatedAt: null };
    }
    throw new Error(error.message || "설정 조회에 실패했습니다.");
  }

  if (!data) {
    return { autoEnter: false, updatedAt: null };
  }

  return {
    autoEnter: Boolean(data.auto_enter),
    updatedAt: data.updated_at ? String(data.updated_at) : null,
  };
}

/** 자동 입장 모드 ON/OFF */
export async function setAutoEnterMode(enabled: boolean): Promise<StoreSettings> {
  const payload = {
    id: SETTINGS_ID,
    auto_enter: enabled,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("store_settings")
    .upsert(payload, { onConflict: "id" })
    .select("auto_enter, updated_at")
    .single();

  if (error) {
    throw new Error(error.message || "자동 입장 설정 저장에 실패했습니다.");
  }

  return {
    autoEnter: Boolean(data.auto_enter),
    updatedAt: data.updated_at ? String(data.updated_at) : null,
  };
}
