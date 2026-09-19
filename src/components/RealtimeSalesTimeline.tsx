"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEventDay } from "@/hooks/useEventDay";
import { fetchSaleLogsWithProducts } from "@/lib/fetchSalesReport";
import { supabase } from "@/lib/supabase";
import type { SaleLogWithProduct } from "@/types/salesReport";

function formatTime(value: string): string {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatCurrency(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

/**
 * 선택한 행사 일자의 판매 로그를 최신순으로 보여 주고,
 * sales_logs INSERT 시 새로고침 없이 상단에 하이라이트하며 추가.
 */
export default function RealtimeSalesTimeline() {
  const { eventDay } = useEventDay();
  const [sales, setSales] = useState<SaleLogWithProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(() => new Set());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const highlightTimersRef = useRef<Map<string, number>>(new Map());

  const markHighlighted = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setHighlightIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    for (const id of ids) {
      const existing = highlightTimersRef.current.get(id);
      if (existing != null) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        setHighlightIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        highlightTimersRef.current.delete(id);
      }, 2500);
      highlightTimersRef.current.set(id, timer);
    }
  }, []);

  const load = useCallback(
    async (options?: { silent?: boolean; flashNew?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
        setError(null);
      }

      try {
        const logs = await fetchSaleLogsWithProducts(eventDay);
        if (options?.flashNew) {
          const fresh = logs
            .map((log) => log.id)
            .filter((id) => !knownIdsRef.current.has(id));
          markHighlighted(fresh);
        }
        knownIdsRef.current = new Set(logs.map((log) => log.id));
        setSales(logs);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "판매 내역을 불러오지 못했습니다.";
        console.error(err);
        if (!options?.silent) setError(message);
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [eventDay, markHighlighted]
  );

  useEffect(() => {
    knownIdsRef.current = new Set();
    void load();
  }, [load]);

  useEffect(() => {
    let debounceTimer: number | null = null;

    const channel = supabase
      .channel(`realtime:sales-timeline:${eventDay}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_logs" },
        (payload) => {
          const row = (payload.new ?? {}) as { day_number?: number | string };
          const day =
            row.day_number != null ? Number(row.day_number) : null;
          // 다른 일차 INSERT는 무시 (DELETE 등은 전체 갱신)
          if (
            payload.eventType === "INSERT" &&
            day != null &&
            day !== eventDay
          ) {
            return;
          }
          if (debounceTimer != null) window.clearTimeout(debounceTimer);
          debounceTimer = window.setTimeout(() => {
            void load({ silent: true, flashNew: true });
          }, 80);
        }
      )
      .subscribe();

    return () => {
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      void supabase.removeChannel(channel);
    };
  }, [eventDay, load]);

  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            {eventDay}일차 실시간 판매 내역
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            결제 완료 시 최신순으로 바로 반영됩니다
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          LIVE
        </span>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-5 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs tracking-wide text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-4 py-3 font-semibold sm:px-5">
                결제 시간
              </th>
              <th className="whitespace-nowrap px-4 py-3 font-semibold sm:px-5">
                제품명
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-semibold sm:px-5">
                수량
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-right font-semibold sm:px-5">
                결제 금액
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={index} className="border-t border-slate-100">
                  <td colSpan={4} className="px-4 py-3 sm:px-5">
                    <div className="h-8 animate-pulse rounded-lg bg-slate-100" />
                  </td>
                </tr>
              ))
            ) : sales.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-14 text-center text-slate-500 sm:px-5"
                >
                  아직 이 일차의 판매 기록이 없습니다
                </td>
              </tr>
            ) : (
              sales.map((sale, index) => {
                const isNew = highlightIds.has(sale.id);
                return (
                  <tr
                    key={sale.id}
                    className={[
                      "border-t border-slate-100 transition-colors duration-[1800ms] ease-out",
                      isNew
                        ? "bg-sky-100"
                        : index === 0
                          ? "bg-sky-50/40"
                          : "bg-white hover:bg-slate-50/80",
                    ].join(" ")}
                  >
                    <td className="whitespace-nowrap px-4 py-3.5 sm:px-5">
                      <time className="text-sm font-bold tabular-nums text-sky-700">
                        {formatTime(sale.createdAt)}
                      </time>
                    </td>
                    <td className="min-w-[10rem] px-4 py-3.5 sm:px-5">
                      <p className="text-xs font-medium text-slate-400">
                        {sale.brand}
                      </p>
                      <p className="font-semibold text-slate-900">
                        {sale.productName}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums font-semibold text-slate-900 sm:px-5">
                      {sale.quantity}
                      <span className="ml-0.5 text-xs font-medium text-slate-500">
                        개
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums font-bold text-emerald-700 sm:px-5">
                      {formatCurrency(sale.totalPrice)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
