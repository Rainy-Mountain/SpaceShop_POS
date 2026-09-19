"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  clearAllSmartOrderTestData,
  deleteQueueEntry,
  sendOrderToPos,
  SMART_ORDER_TRUNCATE_HINT,
} from "@/lib/orderActions";
import { getSupabase } from "@/lib/supabase";

type OrderItemPreview = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
};

type ActiveOrderPreview = {
  id: string;
  status: "shopping" | "pending" | string;
  items: OrderItemPreview[];
};

type QueueEntry = {
  id: string;
  queueNumber: number;
  customerName: string;
  createdAt: string;
  queueStatus: string;
  activeOrder: ActiveOrderPreview | null;
  hideFromBoard: boolean;
};

type QueuePhase = "shopping" | "awaiting_payment";

function normalizeOrdersRelation(orders: unknown): Array<{
  id?: string;
  status?: string;
  created_at?: string;
  order_items?: unknown;
}> {
  if (!orders) return [];
  if (Array.isArray(orders)) return orders;
  return [
    orders as {
      id?: string;
      status?: string;
      created_at?: string;
      order_items?: unknown;
    },
  ];
}

function normalizeItemsRelation(items: unknown): Array<{
  id?: string;
  product_id?: string;
  product_name?: string;
  quantity?: number | string;
}> {
  if (!items) return [];
  if (Array.isArray(items)) return items;
  return [
    items as {
      id?: string;
      product_id?: string;
      product_name?: string;
      quantity?: number | string;
    },
  ];
}

function mapQueueRow(row: {
  id?: string;
  queue_number?: number | string;
  customer_name?: string;
  created_at?: string;
  status?: string;
  orders?: unknown;
}): QueueEntry {
  const rowStatus = String(row.status ?? "waiting");
  const orders = normalizeOrdersRelation(row.orders)
    .map((order) => {
      const items = normalizeItemsRelation(order.order_items).map((item) => ({
        id: String(item.id ?? ""),
        productId: String(item.product_id ?? ""),
        productName: String(item.product_name ?? "제품").trim() || "제품",
        quantity: Number(item.quantity) || 0,
      }));
      return {
        id: String(order.id ?? ""),
        status: String(order.status ?? ""),
        createdAt: String(order.created_at ?? ""),
        items: items.filter((item) => item.quantity > 0),
      };
    })
    .filter((order) => order.id);

  const activeCandidates = orders
    .filter(
      (order) => order.status === "shopping" || order.status === "pending"
    )
    .sort((a, b) => {
      // pending 우선, 그다음 최신
      if (a.status !== b.status) {
        if (a.status === "pending") return -1;
        if (b.status === "pending") return 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });

  const active = activeCandidates[0] ?? null;
  const hasFinishedOnly =
    orders.length > 0 &&
    orders.every(
      (order) => order.status === "paid" || order.status === "completed"
    );

  const hideFromBoard =
    rowStatus === "completed" ||
    rowStatus === "cancelled" ||
    hasFinishedOnly;

  return {
    id: String(row.id),
    queueNumber: Number(row.queue_number) || 0,
    customerName: String(row.customer_name ?? "손님"),
    createdAt: String(row.created_at ?? ""),
    queueStatus: rowStatus,
    activeOrder: active
      ? {
          id: active.id,
          status: active.status,
          items: active.items,
        }
      : null,
    hideFromBoard,
  };
}

function getPhase(entry: QueueEntry): QueuePhase {
  if (entry.activeOrder?.status === "pending") return "awaiting_payment";
  return "shopping";
}

/**
 * 직원용 — QR + 실시간 장바구니 모니터링 + 포스기 전송
 */
export default function StaffQrBoard() {
  const [joinUrl, setJoinUrl] = useState("");
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [storageByProduct, setStorageByProduct] = useState<Map<string, number>>(
    () => new Map()
  );
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
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

  const loadStorageMap = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("inventory")
      .select("product_id, storage_qty");
    if (error) {
      console.error("[StaffQrBoard] inventory 조회 실패", error);
      return;
    }
    const map = new Map<string, number>();
    for (const row of data ?? []) {
      map.set(String(row.product_id), Number(row.storage_qty) || 0);
    }
    setStorageByProduct(map);
  }, []);

  const loadQueues = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoadingList(true);
      setListError(null);
    }
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("queues")
        .select(
          `
          id,
          queue_number,
          customer_name,
          created_at,
          status,
          orders (
            id,
            status,
            created_at,
            order_items (
              id,
              product_id,
              product_name,
              quantity
            )
          )
        `
        )
        .neq("status", "completed")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      const mapped = (data ?? [])
        .map((row) => mapQueueRow(row))
        .filter((entry) => !entry.hideFromBoard);

      setEntries(mapped);
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
    void loadStorageMap();
  }, [loadQueues, loadStorageMap]);

  // queues / orders / order_items / inventory 통합 Realtime
  useEffect(() => {
    if (typeof window === "undefined") return;

    const supabase = getSupabase();
    let debounceTimer: number | null = null;
    let pollTimer: number | null = null;
    let disposed = false;

    const scheduleRefresh = () => {
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        if (!disposed) {
          void loadQueues({ silent: true });
          void loadStorageMap();
        }
      }, 180);
    };

    const suffix =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`;

    const channel = supabase
      .channel(`staff-qr-board:${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queues" },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory" },
        () => {
          if (!disposed) void loadStorageMap();
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.info("[StaffQrBoard] realtime subscribed");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[StaffQrBoard] realtime", status, err);
        }
      });

    pollTimer = window.setInterval(() => {
      if (!disposed) {
        void loadQueues({ silent: true });
        void loadStorageMap();
      }
    }, 8000);

    return () => {
      disposed = true;
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      if (pollTimer != null) window.clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
  }, [loadQueues, loadStorageMap]);

  async function handleSendToPos(entry: QueueEntry) {
    const order = entry.activeOrder;
    if (!order || order.status !== "shopping" || order.items.length === 0) {
      window.alert("장바구니가 비어 있거나 이미 포스기로 전달된 주문입니다.");
      return;
    }

    const ok = window.confirm(
      `${entry.queueNumber}번 ${entry.customerName}님 주문을 포스기로 넘길까요?`
    );
    if (!ok) return;

    setSendingId(entry.id);
    try {
      await sendOrderToPos(order.id);
      // 낙관적 UI: shopping → pending
      setEntries((prev) =>
        prev.map((row) =>
          row.id === entry.id && row.activeOrder
            ? {
                ...row,
                activeOrder: { ...row.activeOrder, status: "pending" },
              }
            : row
        )
      );
    } catch (err) {
      console.error("[StaffQrBoard] sendOrderToPos 실패", err);
      const message =
        err instanceof Error ? err.message : "포스기 전송에 실패했습니다.";
      window.alert(message);
      void loadQueues({ silent: true });
    } finally {
      setSendingId(null);
    }
  }

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
            장바구니를 확인한 뒤 포스기로 넘겨 주세요.
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

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                실시간 장바구니 현황
              </h2>
              <p className="mt-0.5 text-xs text-gray-400">
                담기/빼기 즉시 반영 · 포스기 전송
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              LIVE
            </span>
          </div>

          <div className="max-h-[min(36rem,65vh)] overflow-y-auto px-3 py-3 sm:px-4">
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
                    className="h-20 animate-pulse rounded-xl bg-gray-100"
                  />
                ))}
              </div>
            ) : entries.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">
                아직 등록된 손님이 없습니다
              </p>
            ) : (
              <ul className="space-y-2.5">
                {entries.map((entry) => {
                  const phase = getPhase(entry);
                  const items = entry.activeOrder?.items ?? [];
                  const canSend =
                    phase === "shopping" &&
                    items.length > 0 &&
                    entry.activeOrder?.status === "shopping";

                  return (
                    <li
                      key={entry.id}
                      className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 sm:px-4"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-14 shrink-0 flex-col items-center justify-center rounded-lg bg-white">
                          <span className="text-[10px] font-medium text-gray-400">
                            순번
                          </span>
                          <span className="text-xl font-black tabular-nums text-gray-900">
                            {entry.queueNumber}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-base font-bold text-gray-900">
                              {entry.customerName}
                            </p>
                            {phase === "shopping" ? (
                              <span className="inline-flex items-center truncate rounded-md bg-gray-200/80 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                                🛒 모바일 쇼핑 중...
                              </span>
                            ) : (
                              <span className="inline-flex items-center truncate rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                                💳 결제 대기
                              </span>
                            )}
                          </div>

                          {items.length > 0 ? (
                            <ul className="mt-2 space-y-1">
                              {items.map((item) => {
                                const storage =
                                  storageByProduct.get(item.productId) ?? null;
                                const lowStock = storage === 1;
                                return (
                                  <li
                                    key={item.id || `${item.productId}-${item.productName}`}
                                    className="flex items-start gap-1.5 text-xs leading-snug text-gray-600"
                                  >
                                    <span className="mt-0.5 text-gray-300">
                                      ·
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="font-medium text-gray-700">
                                        {item.productName}
                                      </span>
                                      <span className="text-gray-400">
                                        {" "}
                                        ({item.quantity}개)
                                      </span>
                                      {lowStock && (
                                        <span className="ml-1.5 inline-flex align-middle rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
                                          🚨 재고 1개
                                        </span>
                                      )}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="mt-1 text-xs text-gray-400">
                              아직 담은 제품이 없습니다
                            </p>
                          )}
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          {canSend && (
                            <button
                              type="button"
                              disabled={sendingId === entry.id}
                              onClick={() => void handleSendToPos(entry)}
                              className="rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap text-white hover:bg-sky-500 disabled:bg-slate-300"
                            >
                              {sendingId === entry.id
                                ? "전송 중…"
                                : "포스기로 넘기기"}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={deletingId === entry.id}
                            onClick={() => void handleDeleteEntry(entry)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                            aria-label={`${entry.customerName} 대기열 삭제`}
                            title="삭제"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                              className="h-4 w-4"
                              aria-hidden
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 12.054A3 3 0 0 1 15.916 21H8.084a3 3 0 0 1-2.992-2.786L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.927 2.71-3.346A48.788 48.788 0 0 1 12 1.5c1.276 0 2.54.078 3.79.233 1.497.419 2.71 1.782 2.71 3.346ZM6.844 6.75l.948 11.368a1.5 1.5 0 0 0 1.492 1.382h7.432a1.5 1.5 0 0 0 1.492-1.382l.948-11.368H6.844ZM9.75 9a.75.75 0 0 1 .75.75v6.75a.75.75 0 0 1-1.5 0V9.75A.75.75 0 0 1 9.75 9Zm4.5 0a.75.75 0 0 1 .75.75v6.75a.75.75 0 0 1-1.5 0V9.75a.75.75 0 0 1 .75-.75Z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
