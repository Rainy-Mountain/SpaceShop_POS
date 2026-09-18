"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearAllSmartOrderTestData,
  deleteQueueEntry,
  SMART_ORDER_TRUNCATE_HINT,
} from "@/lib/orderActions";
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

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

  async function handleDeleteEntry(entry: QueueEntry) {
    const ok = window.confirm(
      "이 대기열/주문 내역을 정말 삭제하시겠습니까?"
    );
    if (!ok) return;

    setDeletingId(entry.id);
    try {
      await deleteQueueEntry(entry.id);
      setEntries((prev) => prev.filter((row) => row.id !== entry.id));
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error ? err.message : "삭제에 실패했습니다.";
      window.alert(message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleClearAll() {
    const ok = window.confirm(
      "경고: 현재 쌓여있는 모든 대기열과 주문 내역이 완전히 삭제됩니다. 실전 행사 중이라면 절대 누르지 마세요. 계속하시겠습니까?"
    );
    if (!ok) return;

    setClearingAll(true);
    try {
      await clearAllSmartOrderTestData();
      window.location.reload();
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error ? err.message : SMART_ORDER_TRUNCATE_HINT;
      window.alert(message);
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-4.5rem)] w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="text-center sm:text-left">
          <p className="text-sm font-medium tracking-wide text-sky-600">
            SpaceShop Staff
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
            손님 안내용 QR 코드
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            스마트폰 카메라로 스캔하여 대기열에 등록해주세요.
          </p>
        </div>
        <button
          type="button"
          disabled={clearingAll}
          onClick={() => void handleClearAll()}
          className="shrink-0 self-center rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 sm:self-start"
        >
          {clearingAll ? "초기화 중…" : "테스트 데이터 전체 초기화"}
        </button>
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
                    <button
                      type="button"
                      disabled={deletingId === entry.id}
                      onClick={() => void handleDeleteEntry(entry)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                      aria-label={`${entry.customerName} 대기열 삭제`}
                      title="삭제"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-5 w-5"
                        aria-hidden
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 12.054A3 3 0 0 1 15.916 21H8.084a3 3 0 0 1-2.992-2.786L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.927 2.71-3.346A48.788 48.788 0 0 1 12 1.5c1.276 0 2.54.078 3.79.233 1.497.419 2.71 1.782 2.71 3.346ZM6.844 6.75l.948 11.368a1.5 1.5 0 0 0 1.492 1.382h7.432a1.5 1.5 0 0 0 1.492-1.382l.948-11.368H6.844ZM9.75 9a.75.75 0 0 1 .75.75v6.75a.75.75 0 0 1-1.5 0V9.75A.75.75 0 0 1 9.75 9Zm4.5 0a.75.75 0 0 1 .75.75v6.75a.75.75 0 0 1-1.5 0V9.75a.75.75 0 0 1 .75-.75Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
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
