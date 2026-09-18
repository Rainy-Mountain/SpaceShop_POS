"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/**
 * 손님용 — 성함 입력 후 순번 발급 → /order?queue_id=…
 */
export default function QueueJoinBoard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const customerName = name.trim();
    if (!customerName) {
      setError("성함을 입력해 주세요.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
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
          customer_name: customerName,
          status: "waiting",
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

  return (
    <main className="flex min-h-screen flex-col bg-gray-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="text-center">
          <h1 className="text-2xl font-extrabold leading-tight tracking-tight text-gray-900 whitespace-pre-line sm:text-3xl">
            {"스페이스 샵 4주년\n스마트 오더 입장"}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            성함을 입력하시면 대기 순번이 발급됩니다.
          </p>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="mt-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-gray-700">
              성함
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={loading}
              placeholder="예: 홍길동"
              autoComplete="name"
              autoFocus
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 outline-none placeholder:text-gray-400 focus:border-sky-500 disabled:opacity-60"
            />
          </label>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="w-full rounded-xl bg-sky-600 px-4 py-3.5 text-base font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {loading ? "발급 중..." : "순번 발급받고 입장하기"}
          </button>
        </form>
      </div>
    </main>
  );
}
