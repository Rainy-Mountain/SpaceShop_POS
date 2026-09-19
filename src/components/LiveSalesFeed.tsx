"use client";

import { useEffect, useState } from "react";
import { useEventDay } from "@/hooks/useEventDay";
import { undoSale, undoSaleGroup } from "@/lib/inventoryActions";
import { fetchSalePaymentGroups } from "@/lib/fetchSalesReport";
import { supabase } from "@/lib/supabase";
import type { SalePaymentGroup, SalePaymentGroupItem } from "@/types/salesReport";

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

/** queues?.customer_name 있으면 순번+폰, 없으면 워크인 */
function formatGuestLabel(group: {
  customerName?: string | null;
  queueNumber?: number | null;
}): string {
  // order.queues?.customer_name 매핑값
  const phone = group.customerName?.trim() ?? "";
  const hasPhone =
    Boolean(phone) &&
    phone !== "현장" &&
    phone !== "손님" &&
    phone !== "현장 손님" &&
    phone !== "워크인";

  if (!hasPhone) {
    return "워크인";
  }

  const queueNumber = group.queueNumber ?? 0;
  return `[순번: ${queueNumber}번] ${phone}님`;
}

function isWalkInGuest(group: {
  customerName?: string | null;
  queueNumber?: number | null;
}): boolean {
  return formatGuestLabel(group) === "워크인";
}

export default function LiveSalesFeed() {
  const { eventDay, eventDayReady } = useEventDay();
  const [groups, setGroups] = useState<SalePaymentGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingGroupKey, setCancellingGroupKey] = useState<string | null>(
    null
  );
  const [cancellingSaleId, setCancellingSaleId] = useState<string | null>(null);

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
    if (!eventDayReady) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventDay, eventDayReady]);

  useEffect(() => {
    if (!eventDayReady) return;

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
  }, [eventDay, eventDayReady]);

  async function handleCancelGroup(group: SalePaymentGroup) {
    if (cancellingGroupKey || cancellingSaleId) return;

    const label = formatGuestLabel(group);
    const ok = window.confirm(
      isWalkInGuest(group)
        ? "이 워크인 결제 건 전체를 취소하시겠습니까?\n(취소 시 판매 기록에서 삭제되며 재고가 다시 복구됩니다.)"
        : `${label}의 주문 전체를 취소하시겠습니까?\n(취소 시 판매 기록에서 삭제되며 재고가 다시 복구됩니다.)`
    );
    if (!ok) return;

    setCancellingGroupKey(group.groupKey);
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
      setCancellingGroupKey(null);
    }
  }

  async function handleCancelItem(
    group: SalePaymentGroup,
    item: SalePaymentGroupItem
  ) {
    if (cancellingGroupKey || cancellingSaleId) return;

    const ok = window.confirm(
      "해당 품목만 결제 취소 및 재고를 원복하시겠습니까?"
    );
    if (!ok) return;

    setCancellingSaleId(item.saleId);

    // 낙관적 UI: 품목 제거 + 총액 차감, 품목 없으면 그룹 삭제
    setGroups((prev) =>
      prev
        .map((row) => {
          if (row.groupKey !== group.groupKey) return row;
          const nextItems = row.items.filter((i) => i.saleId !== item.saleId);
          const nextSaleIds = row.saleIds.filter((id) => id !== item.saleId);
          return {
            ...row,
            items: nextItems,
            saleIds: nextSaleIds,
            totalPrice: Math.max(0, row.totalPrice - item.totalPrice),
          };
        })
        .filter((row) => row.items.length > 0)
    );

    try {
      await undoSale(item.saleId);
      window.alert("해당 품목 취소 및 재고 복구가 완료되었습니다.");
    } catch (err) {
      console.error("[LiveSalesFeed] undoSale 실패", err);
      const message =
        err instanceof Error ? err.message : "개별 취소에 실패했습니다.";
      window.alert(message);
      void load({ silent: true });
    } finally {
      setCancellingSaleId(null);
    }
  }

  const busy = cancellingGroupKey !== null || cancellingSaleId !== null;

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

      {loading || !eventDayReady ? (
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
            const isCancellingGroup = cancellingGroupKey === group.groupKey;
            return (
              <li
                key={group.groupKey}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm sm:px-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <time className="text-sm font-bold tabular-nums text-sky-700">
                      {formatTime(group.createdAt)}
                    </time>
                    <span className="text-sm font-semibold text-gray-800">
                      {formatGuestLabel(group)}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleCancelGroup(group)}
                    className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-400 transition-all duration-200 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    title="결제 건 전체 취소 · 재고 원복"
                  >
                    {isCancellingGroup ? "취소 중…" : "전체 취소"}
                  </button>
                </div>

                <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  {group.items.map((item) => {
                    const isCancellingItem = cancellingSaleId === item.saleId;
                    return (
                      <li
                        key={item.saleId}
                        className="flex items-center gap-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate text-slate-800">
                          {item.productName}
                          <span className="text-slate-500">
                            {" "}
                            x {item.quantity}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold text-slate-700">
                          {formatCurrency(item.totalPrice)}
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleCancelItem(group, item)}
                          className="shrink-0 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-400 transition-all duration-200 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                          title="이 품목만 취소"
                        >
                          {isCancellingItem ? "…" : "개별 취소"}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <p className="mt-3 border-t border-slate-100 pt-2.5 text-right text-base font-extrabold tabular-nums text-emerald-700">
                  총 {formatCurrency(group.totalPrice)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
