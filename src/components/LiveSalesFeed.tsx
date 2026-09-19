"use client";

import { useEffect, useState } from "react";
import { useEventDay } from "@/hooks/useEventDay";
import { undoSale } from "@/lib/inventoryActions";
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

export default function LiveSalesFeed() {
  const { eventDay } = useEventDay();
  const [sales, setSales] = useState<SaleLogWithProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const logs = await fetchSaleLogsWithProducts(eventDay);
      setSales(logs);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "판매 기록을 불러오지 못했습니다.";
      console.error(err);
      if (!options?.silent) setError(message);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventDay]);

  useEffect(() => {
    let timer: number | null = null;

    const channel = supabase
      .channel("realtime:sales-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_logs" },
        () => {
          if (timer != null) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            void load({ silent: true });
          }, 120);
        }
      )
      .subscribe();

    return () => {
      if (timer != null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventDay]);

  async function handleCancelSale(sale: SaleLogWithProduct) {
    if (cancellingId) return;

    const ok = window.confirm(
      "정말 이 결제 내역을 취소하시겠습니까?\n(취소 시 판매 기록에서 삭제되며 재고가 다시 복구됩니다.)"
    );
    if (!ok) return;

    setCancellingId(sale.id);
    // 즉시 목록에서 제거
    setSales((prev) => prev.filter((row) => row.id !== sale.id));

    try {
      await undoSale(sale.id);
      window.alert("취소 및 재고 복구가 완료되었습니다.");
    } catch (err) {
      console.error("[LiveSalesFeed] undoSale 실패", err);
      const message =
        err instanceof Error ? err.message : "결제 취소에 실패했습니다.";
      window.alert(message);
      void load({ silent: true });
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          실시간 판매 기록
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {eventDay}일차 판매 현황 · 최신순
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-xl bg-slate-200/70"
            />
          ))}
        </div>
      ) : sales.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <p className="text-lg font-semibold text-slate-800">
            아직 판매 기록이 없습니다
          </p>
          <p className="mt-1 text-sm text-slate-500">
            키오스크나 현황판에서 판매가 등록되면 여기에 표시됩니다
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {sales.map((sale) => {
            const isCancelling = cancellingId === sale.id;
            return (
              <li
                key={sale.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <time className="w-14 shrink-0 text-sm font-bold tabular-nums text-sky-700">
                  {formatTime(sale.createdAt)}
                </time>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-400">
                    {sale.brand}
                  </p>
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {sale.productName}
                  </p>
                </div>
                <p className="shrink-0 text-base font-bold tabular-nums text-slate-900">
                  {sale.quantity}
                  <span className="ml-0.5 text-xs font-semibold text-slate-500">
                    개
                  </span>
                </p>
                <button
                  type="button"
                  disabled={cancellingId !== null}
                  onClick={() => void handleCancelSale(sale)}
                  className="shrink-0 rounded border border-red-200 px-2 py-1 text-[10px] font-medium text-red-500 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                  title="결제 취소 · 재고 원복"
                >
                  {isCancelling ? "취소 중…" : "↩️ 결제 취소"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
