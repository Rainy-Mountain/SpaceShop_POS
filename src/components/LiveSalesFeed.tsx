"use client";

import { useEffect, useState } from "react";
import { useEventDay } from "@/hooks/useEventDay";
import { undoSaleGroup } from "@/lib/inventoryActions";
import { fetchSalePaymentGroups } from "@/lib/fetchSalesReport";
import { supabase } from "@/lib/supabase";
import type { SalePaymentGroup } from "@/types/salesReport";

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
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function formatItemsLine(group: SalePaymentGroup): string {
  return group.items
    .map((item) => `${item.productName} x ${item.quantity}`)
    .join(", ");
}

export default function LiveSalesFeed() {
  const { eventDay } = useEventDay();
  const [groups, setGroups] = useState<SalePaymentGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const data = await fetchSalePaymentGroups(eventDay);
      setGroups(data);
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

  async function handleCancelGroup(group: SalePaymentGroup) {
    if (cancellingKey) return;

    const label = group.customerName?.trim() || "손님";
    const ok = window.confirm(
      label === "현장"
        ? "이 현장 결제 건 전체를 취소하시겠습니까?\n(취소 시 판매 기록에서 삭제되며 재고가 다시 복구됩니다.)"
        : `${label}번 손님의 주문 전체를 취소하시겠습니까?\n(취소 시 판매 기록에서 삭제되며 재고가 다시 복구됩니다.)`
    );
    if (!ok) return;

    setCancellingKey(group.groupKey);
    setGroups((prev) => prev.filter((row) => row.groupKey !== group.groupKey));

    try {
      await undoSaleGroup(group.saleIds);
      window.alert("취소 및 재고 복구가 완료되었습니다.");
    } catch (err) {
      console.error("[LiveSalesFeed] undoSaleGroup 실패", err);
      const message =
        err instanceof Error ? err.message : "결제 취소에 실패했습니다.";
      window.alert(message);
      void load({ silent: true });
    } finally {
      setCancellingKey(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          실시간 판매 기록
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {eventDay}일차 · 결제 건(영수증) 단위 · 최신순
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
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="h-28 animate-pulse rounded-2xl bg-slate-200/70"
            />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
          <p className="text-lg font-semibold text-slate-800">
            아직 판매 기록이 없습니다
          </p>
          <p className="mt-1 text-sm text-slate-500">
            키오스크나 현황판에서 판매가 등록되면 여기에 표시됩니다
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {groups.map((group) => {
            const isCancelling = cancellingKey === group.groupKey;
            return (
              <li
                key={group.groupKey}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm sm:px-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <time className="text-sm font-bold tabular-nums text-sky-700">
                        {formatTime(group.createdAt)}
                      </time>
                      <span className="text-sm font-bold text-slate-900">
                        손님 번호: {group.customerName}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-700">
                      {formatItemsLine(group)}
                    </p>
                    <p className="mt-2 text-base font-extrabold tabular-nums text-emerald-700">
                      총 {formatCurrency(group.totalPrice)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={cancellingKey !== null}
                    onClick={() => void handleCancelGroup(group)}
                    className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-400 transition-all duration-200 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    title="결제 건 전체 취소 · 재고 원복"
                  >
                    {isCancelling ? "취소 중…" : "결제 취소"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
