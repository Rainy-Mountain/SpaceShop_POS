"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchRecentActivities,
  undoMovement,
  undoSale,
} from "@/lib/inventoryActions";
import type { RecentActivityItem } from "@/types/dashboard";
import { LOCATION_LABELS } from "@/types/dashboard";

interface RecentActivityPanelProps {
  refreshKey: number;
  onUndone: () => Promise<void> | void;
  /** Realtime에서 판매 로그 삭제 시 호출 */
  onRegisterRemoveById?: (removeById: (id: string) => void) => void;
}

function formatDateTime(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export default function RecentActivityPanel({
  refreshKey,
  onUndone,
  onRegisterRemoveById,
}: RecentActivityPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<RecentActivityItem[]>([]);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRecentActivities(40);
      setItems(data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "최근 작업 내역을 불러오지 못했습니다.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, refreshKey, load]);

  useEffect(() => {
    onRegisterRemoveById?.((id) => {
      setItems((prev) => prev.filter((item) => item.id !== id));
    });
  }, [onRegisterRemoveById]);

  async function handleUndo(item: RecentActivityItem) {
    const confirmed = window.confirm(
      item.type === "sale"
        ? `"${item.productName}" 판매 ${item.quantity}개를 취소할까요?`
        : `"${item.productName}" 재고 이동 ${item.quantity}개를 취소할까요?`
    );
    if (!confirmed) return;

    setUndoingId(item.id);

    // 즉시 목록에서 제거
    setItems((prev) => prev.filter((row) => row.id !== item.id));

    try {
      if (item.type === "sale") {
        await undoSale(item.id);
      } else {
        await undoMovement(item.id);
      }
      await onUndone();
    } catch (err) {
      // 실패 시 목록 복구 + 재조회
      setItems((prev) => [item, ...prev]);
      await onUndone();
      const message =
        err instanceof Error ? err.message : "실행 취소에 실패했습니다.";
      alert(message);
    } finally {
      setUndoingId(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-800"
      >
        최근 작업 내역
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <button
            type="button"
            aria-label="패널 닫기"
            className="absolute inset-0 bg-slate-900/30"
            onClick={() => setOpen(false)}
          />

          <aside className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  최근 작업 내역
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  판매·재고 이동을 최신순으로 확인하고 취소할 수 있습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loading && (
                <p className="py-10 text-center text-sm text-slate-500">
                  불러오는 중...
                </p>
              )}

              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              )}

              {!loading && !error && items.length === 0 && (
                <p className="py-10 text-center text-sm text-slate-500">
                  최근 작업 내역이 없습니다.
                </p>
              )}

              <ul className="space-y-3">
                {items.map((item) => (
                  <li
                    key={`${item.type}-${item.id}`}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span
                          className={[
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold",
                            item.type === "sale"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-sky-100 text-sky-700",
                          ].join(" ")}
                        >
                          {item.type === "sale" ? "판매" : "재고 이동"}
                        </span>
                        <p className="mt-2 text-sm font-semibold text-slate-900">
                          {item.productName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.brand} · {formatDateTime(item.createdAt)}
                        </p>
                        {item.type === "sale" ? (
                          <p className="mt-2 text-sm text-slate-700">
                            {item.dayNumber}일차 ·{" "}
                            {LOCATION_LABELS[item.soldFrom]}에서 {item.quantity}
                            개 · {formatPrice(item.totalPrice)}원
                          </p>
                        ) : (
                          <p className="mt-2 text-sm text-slate-700">
                            {LOCATION_LABELS[item.fromLocation]} →{" "}
                            {LOCATION_LABELS[item.toLocation]} · {item.quantity}
                            개
                          </p>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={undoingId === item.id}
                        onClick={() => void handleUndo(item)}
                        className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        {undoingId === item.id ? "취소 중..." : "실행 취소"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
