"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type QueueEntry = {
  id: string;
  queueNumber: number;
  customerName: string;
  createdAt: string;
};

/**
 * 직원용 — 손님 안내용 QR + 실시간 대기열 등록 현황
 * (공통 AppNav와 함께 표시)
 */
export default function StaffQrBoard() {
  const [joinUrl, setJoinUrl] = useState("");
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      window.location.origin;
    setJoinUrl(`${origin}/queue/join`);
  }, []);

  const qrSrc = useMemo(() => {
    if (!joinUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(joinUrl)}`;
  }, [joinUrl]);

  const loadQueues = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoadingList(true);
      setListError(null);
    }
    try {
      const { data, error } = await supabase
        .from("queues")
        .select("id, queue_number, customer_name, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      setEntries(
        (data ?? []).map((row) => ({
          id: String(row.id),
          queueNumber: Number(row.queue_number) || 0,
          customerName: String(row.customer_name ?? "손님"),
          createdAt: String(row.created_at ?? ""),
        }))
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" &&
              err !== null &&
              "message" in err &&
              typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "대기열을 불러오지 못했습니다.";
      console.error("[StaffQrBoard] queues load 실패", err);
      if (!options?.silent) setListError(message);
    } finally {
      if (!options?.silent) setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void loadQueues();
  }, [loadQueues]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const channel = supabase
      .channel("realtime:staff-qr-queues")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "queues" },
        (payload) => {
          const row = (payload.new ?? {}) as {
            id?: string;
            queue_number?: number | string;
            customer_name?: string;
            created_at?: string;
          };
          const id = String(row.id ?? "");
          if (!id) {
            void loadQueues({ silent: true });
            return;
          }

          const entry: QueueEntry = {
            id,
            queueNumber: Number(row.queue_number) || 0,
            customerName: String(row.customer_name ?? "손님"),
            createdAt: String(row.created_at ?? new Date().toISOString()),
          };

          setEntries((prev) => {
            if (prev.some((item) => item.id === id)) return prev;
            return [entry, ...prev].slice(0, 50);
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadQueues]);

  return (
    <main className="mx-auto min-h-[calc(100vh-4.5rem)] w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 text-center sm:text-left">
        <p className="text-sm font-medium tracking-wide text-sky-600">
          SpaceShop Staff
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
          손님 안내용 QR 코드
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          스마트폰 카메라로 스캔하여 대기열에 등록해주세요.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
        {/* QR */}
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mx-auto flex aspect-square w-full max-w-[400px] items-center justify-center">
            {qrSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrSrc}
                alt="대기열 등록 QR 코드"
                width={400}
                height={400}
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="h-48 w-48 animate-pulse rounded-xl bg-gray-100" />
            )}
          </div>
          {joinUrl && (
            <p className="mt-4 break-all text-center text-xs text-gray-400">
              {joinUrl}
            </p>
          )}
        </section>

        {/* 실시간 대기열 */}
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                실시간 대기열 등록 현황
              </h2>
              <p className="mt-0.5 text-xs text-gray-400">
                최신 등록순 · 새로고침 없이 자동 갱신
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              LIVE
            </span>
          </div>

          <div className="max-h-[min(28rem,55vh)] overflow-y-auto px-3 py-3 sm:px-4">
            {listError && (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {listError}
              </p>
            )}

            {loadingList ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-14 animate-pulse rounded-xl bg-gray-100"
                  />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">
                아직 등록된 손님이 없습니다
              </p>
            ) : (
              <ul className="space-y-2">
                {entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 sm:px-4"
                  >
                    <div className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-white">
                      <span className="text-[10px] font-medium text-gray-400">
                        순번
                      </span>
                      <span className="text-xl font-black tabular-nums text-gray-900">
                        {entry.queueNumber}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-bold text-gray-900">
                        {entry.customerName}
                      </p>
                      {entry.createdAt && (
                        <p className="mt-0.5 text-xs text-gray-400">
                          {new Intl.DateTimeFormat("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          }).format(new Date(entry.createdAt))}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
