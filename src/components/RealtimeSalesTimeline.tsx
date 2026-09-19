"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchSaleLogsWithProducts } from "@/lib/fetchSalesReport";
import { supabase } from "@/lib/supabase";
import type { EventDay } from "@/types/dashboard";
import type { SaleLogWithProduct } from "@/types/salesReport";

const EVENT_DAYS: EventDay[] = [1, 2, 3];
const PER_DAY_LIMIT = 4;

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

function formatShortDate(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function groupLatestByDay(
  logs: SaleLogWithProduct[]
): Record<EventDay, SaleLogWithProduct[]> {
  const grouped: Record<EventDay, SaleLogWithProduct[]> = {
    1: [],
    2: [],
    3: [],
  };

  // logs는 이미 created_at 내림차순
  for (const log of logs) {
    const day = log.dayNumber as EventDay;
    if (day !== 1 && day !== 2 && day !== 3) continue;
    if (grouped[day].length >= PER_DAY_LIMIT) continue;
    grouped[day].push(log);
  }

  return grouped;
}

/**
 * 1~3일차 가로 다단 · 각 컬럼 최신 4건 · sales_logs Realtime
 */
export default function RealtimeSalesTimeline() {
  const [byDay, setByDay] = useState<Record<EventDay, SaleLogWithProduct[]>>({
    1: [],
    2: [],
    3: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(
    () => new Set()
  );
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
        const logs = await fetchSaleLogsWithProducts();
        const grouped = groupLatestByDay(logs);
        const visibleIds = EVENT_DAYS.flatMap((day) =>
          grouped[day].map((log) => log.id)
        );

        if (options?.flashNew) {
          const fresh = visibleIds.filter((id) => !knownIdsRef.current.has(id));
          markHighlighted(fresh);
        }

        knownIdsRef.current = new Set(visibleIds);
        setByDay(grouped);
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
    [markHighlighted]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let debounceTimer: number | null = null;

    const channel = supabase
      .channel("realtime:sales-timeline-grid")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_logs" },
        () => {
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
  }, [load]);

  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const dayTitles = useMemo(() => {
    return EVENT_DAYS.map((day) => {
      const sample = byDay[day][0];
      const dateLabel = sample ? formatShortDate(sample.createdAt) : null;
      return {
        day,
        title: dateLabel ? `${day}일차 (${dateLabel})` : `${day}일차`,
      };
    });
  }, [byDay]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            오늘의 실시간 판매 내역
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            일자별 최신 {PER_DAY_LIMIT}건 · 결제 완료 시 바로 반영
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

      <div className="grid grid-cols-1 gap-6 p-4 sm:p-5 md:grid-cols-3">
        {dayTitles.map(({ day, title }) => {
          const sales = byDay[day];
          return (
            <div key={day} className="min-w-0">
              <h3 className="mb-3 border-b border-slate-100 pb-2 text-sm font-bold text-slate-800">
                {title}
              </h3>

              {loading ? (
                <ul className="space-y-2">
                  {Array.from({ length: PER_DAY_LIMIT }).map((_, index) => (
                    <li
                      key={index}
                      className="h-[3.25rem] animate-pulse rounded-lg border border-slate-100 bg-slate-50"
                    />
                  ))}
                </ul>
              ) : sales.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-400">
                  판매 기록 없음
                </p>
              ) : (
                <ul className="space-y-2">
                  {sales.map((sale) => {
                    const isNew = highlightIds.has(sale.id);
                    return (
                      <li
                        key={sale.id}
                        className={[
                          "rounded-lg border px-3 py-2.5 transition-colors duration-[1800ms] ease-out",
                          isNew
                            ? "border-sky-200 bg-sky-100"
                            : "border-slate-200 bg-white",
                        ].join(" ")}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <time className="shrink-0 text-xs font-bold tabular-nums text-sky-700">
                            {formatTime(sale.createdAt)}
                          </time>
                          <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-700">
                            {sale.quantity}개
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm font-semibold leading-snug text-slate-900">
                          {sale.productName}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
