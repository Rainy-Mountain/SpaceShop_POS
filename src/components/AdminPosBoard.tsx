"use client";

import { useCallback, useEffect, useState } from "react";
import { useEventDay } from "@/hooks/useEventDay";
import {
  completePosPayment,
  fetchPendingPosOrders,
  type PendingPosOrder,
} from "@/lib/orderActions";
import { supabase } from "@/lib/supabase";

/**
 * 매니저용 POS — pending 주문 Realtime + 결제 완료(매출 기록·재고 차감)
 */
export default function AdminPosBoard() {
  const { eventDay } = useEventDay();
  const [orders, setOrders] = useState<PendingPosOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

  const loadOrders = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await fetchPendingPosOrders();
      setOrders(data);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "결제 대기열을 불러오지 못했습니다.";
      console.error(err);
      if (!options?.silent) setError(message);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let timer: number | null = null;

    const scheduleReload = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadOrders({ silent: true });
      }, 100);
    };

    const channel = supabase
      .channel("realtime:admin-pos-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        scheduleReload
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        scheduleReload
      )
      .subscribe();

    return () => {
      if (timer != null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [loadOrders]);

  async function handlePay(order: PendingPosOrder) {
    if (payingId) return;

    const confirmed = window.confirm(
      `${order.queueNumber}번 ${order.customerName}님 결제를 완료할까요?\n샵 재고 차감 + ${eventDay}일차 매출 기록이 저장됩니다.`
    );
    if (!confirmed) return;

    setPayingId(order.id);
    // 낙관적 제거
    setOrders((prev) => prev.filter((row) => row.id !== order.id));

    try {
      await completePosPayment(order.id, eventDay);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" &&
              err !== null &&
              "message" in err &&
              typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "결제 처리에 실패했습니다.";
      console.error("[AdminPosBoard] 결제 완료 실패", err);
      window.alert(`결제 실패: ${message}`);
      await loadOrders({ silent: true });
    } finally {
      setPayingId(null);
    }
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-4.5rem)] w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8">
        <p className="text-sm font-medium tracking-wide text-sky-600">
          SpaceShop Admin
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
          실시간 결제 대기열
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          순번 오름차순으로 표시됩니다. 손님이 주문서를 제출하면 자동으로
          갱신됩니다.
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
          <button
            type="button"
            onClick={() => void loadOrders()}
            className="ml-3 font-semibold underline"
          >
            다시 시도
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-20 text-center">
          <p className="text-base font-semibold text-gray-700">
            결제 대기 중인 주문이 없습니다
          </p>
          <p className="mt-2 text-sm text-gray-400">
            손님 주문 제출 시 여기에 실시간으로 표시됩니다.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {orders.map((order) => (
            <li
              key={order.id}
              className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
            >
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-100 bg-gray-50 px-5 py-4 sm:px-6">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-gray-400">
                    대기 순번
                  </p>
                  <p className="mt-0.5 text-4xl font-black tabular-nums text-gray-900 sm:text-5xl">
                    {order.queueNumber}
                    <span className="ml-1 text-lg font-bold text-gray-400 sm:text-xl">
                      번
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold tracking-wide text-gray-400">
                    손님 성함
                  </p>
                  <p className="mt-0.5 text-2xl font-extrabold text-gray-900 sm:text-3xl">
                    {order.customerName}
                  </p>
                </div>
              </div>

              <div className="px-5 py-4 sm:px-6">
                <p className="mb-2 text-xs font-semibold text-gray-400">
                  주문 품목
                </p>
                {order.items.length === 0 ? (
                  <p className="text-sm text-gray-400">품목 없음</p>
                ) : (
                  <ul className="space-y-2">
                    {order.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5"
                      >
                        <span className="min-w-0 truncate text-sm font-medium text-gray-800">
                          {item.productName}
                        </span>
                        <span className="shrink-0 text-sm font-bold tabular-nums text-sky-700">
                          × {item.quantity}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  type="button"
                  disabled={payingId === order.id}
                  onClick={() => void handlePay(order)}
                  className="mt-5 w-full rounded-xl bg-sky-600 px-4 py-4 text-base font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {payingId === order.id ? "처리 중…" : "결제 완료 처리"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
