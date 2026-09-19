"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchStoreSettings } from "@/lib/storeSettings";
import { supabase } from "@/lib/supabase";

const PHONE_TAIL_RE = /^\d{4}$/;

/**
 * 손님용 — 핸드폰 뒷자리 4자리로 이어하기 또는 신규 순번 발급 → /order?queue_id=…
 */
export default function QueueJoinBoard() {
  const router = useRouter();
  const [phoneTail, setPhoneTail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handlePhoneChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    setPhoneTail(digits);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const digits = phoneTail.trim();
    if (!PHONE_TAIL_RE.test(digits)) {
      setError("핸드폰 번호 뒷자리 4자리를 숫자로 입력해 주세요.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1) 동일 뒷자리 + 미완료(completed/cancelled 제외) 대기열 → 이어하기
      const { data: existing, error: existingError } = await supabase
        .from("queues")
        .select("id, status")
        .eq("customer_name", digits)
        .neq("status", "completed")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError) throw existingError;

      if (existing?.id) {
        router.push(`/order?queue_id=${existing.id}`);
        return;
      }

      // 2) 자동 입장 모드 확인
      let initialStatus: "waiting" | "entered" = "waiting";
      try {
        const settings = await fetchStoreSettings();
        if (settings.autoEnter) {
          initialStatus = "entered";
        }
      } catch (settingsErr) {
        console.warn(
          "[QueueJoinBoard] store_settings 조회 실패 — waiting 유지",
          settingsErr
        );
      }

      // 3) 신규 발급
      const { data: maxRows, error: maxError } = await supabase
        .from("queues")
        .select("queue_number")
        .order("queue_number", { ascending: false })
        .limit(1);

      if (maxError) throw maxError;

      const maxNumber =
        maxRows && maxRows.length > 0
          ? Number(maxRows[0].queue_number) || 0
          : 0;
      const nextNumber = maxNumber + 1;

      const { data, error: insertError } = await supabase
        .from("queues")
        .insert({
          queue_number: nextNumber,
          customer_name: digits,
          status: initialStatus,
        })
        .select("id")
        .single();

      if (insertError) throw insertError;
      if (!data?.id) throw new Error("순번 발급에 실패했습니다.");

      router.push(`/order?queue_id=${data.id}`);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" &&
              err !== null &&
              "message" in err &&
              typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "순번 발급에 실패했습니다.";
      console.error(err);
      setError(message);
      setLoading(false);
    }
  }

  const isValid = PHONE_TAIL_RE.test(phoneTail.trim());

  return (
    <main className="flex min-h-screen flex-col bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-gray-900 whitespace-pre-line sm:text-3xl">
            {"스페이스 샵 4주년\n스마트 오더 입장"}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            핸드폰 뒷자리 4자리로 입장하거나, 이어서 주문하세요.
          </p>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="mt-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              핸드폰 번호 뒷자리 4자리
            </span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={phoneTail}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="예: 1234"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center text-2xl font-bold tracking-[0.35em] text-gray-900 outline-none ring-sky-500 focus:ring-2"
            />
          </label>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!isValid || loading}
            className="w-full rounded-xl bg-sky-600 px-4 py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "처리 중…" : "입장하기"}
          </button>
        </form>
      </div>
    </main>
  );
}
