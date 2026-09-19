"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  admitQueueEntry,
  clearAllSmartOrderTestData,
  deleteQueueEntry,
  sendOrderToPos,
  SMART_ORDER_TRUNCATE_HINT,
  updateQueueNumber,
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

type QueuePhase = "waiting_entry" | "shopping" | "awaiting_payment";

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

function isEnteredStatus(status: string): boolean {
  return status === "entered" || status === "ordering";
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
  if (entry.queueStatus === "waiting") return "waiting_entry";
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
  const [admittingId, setAdmittingId] = useState<string | null>(null);
  const [renumberingId, setRenumberingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  useEffect(() => {
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      window.location.origin;
    setJoinUrl(`${origin}/queue/join`);
  }, []);

  const qrSrc = useMemo(() => {
    if (!joinUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(joinUrl)}`;
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
        .filter((entry) => !entry.hideFromBoard)
        .sort((a, b) => {
          if (a.queueNumber !== b.queueNumber) {
            return a.queueNumber - b.queueNumber;
          }
          return a.createdAt.localeCompare(b.createdAt);
        });

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
        (payload) => {
          const next = (payload.new ?? {}) as {
            product_id?: string;
            storage_qty?: number | string | null;
          };
          const productId = String(next.product_id ?? "");
          if (productId && next.storage_qty != null) {
            const storageQty = Number(next.storage_qty) || 0;
            setStorageByProduct((prev) => {
              const map = new Map(prev);
              map.set(productId, storageQty);
              return map;
            });
          } else if (!disposed) {
            void loadStorageMap();
          }
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

  async function handleAdmitEntry(entry: QueueEntry) {
    if (entry.queueStatus !== "waiting") return;

    setAdmittingId(entry.id);
    try {
      await admitQueueEntry(entry.id);
      setEntries((prev) =>
        prev.map((row) =>
          row.id === entry.id ? { ...row, queueStatus: "entered" } : row
        )
      );
    } catch (err) {
      console.error("[StaffQrBoard] admitQueueEntry 실패", err);
      const message =
        err instanceof Error ? err.message : "입장 승인에 실패했습니다.";
      window.alert(message);
      void loadQueues({ silent: true });
    } finally {
      setAdmittingId(null);
    }
  }

  async function handleChangeQueueNumber(entry: QueueEntry) {
    const raw = window.prompt(
      "변경할 새로운 순번을 입력하세요 (숫자만 입력):",
      String(entry.queueNumber)
    );
    if (raw == null) return;

    const nextNumber = Number(String(raw).trim());
    if (!Number.isInteger(nextNumber) || nextNumber < 1) {
      window.alert("1 이상의 정수 순번을 입력해 주세요.");
      return;
    }
    if (nextNumber === entry.queueNumber) return;

    const ok = window.confirm(
      `${entry.queueNumber}번 손님을 ${nextNumber}번으로 변경하시겠습니까?`
    );
    if (!ok) return;

    setRenumberingId(entry.id);
    try {
      await updateQueueNumber(entry.id, nextNumber);
      setEntries((prev) =>
        [...prev]
          .map((row) =>
            row.id === entry.id ? { ...row, queueNumber: nextNumber } : row
          )
          .sort((a, b) => {
            if (a.queueNumber !== b.queueNumber) {
              return a.queueNumber - b.queueNumber;
            }
            return a.createdAt.localeCompare(b.createdAt);
          })
      );
    } catch (err) {
      console.error("[StaffQrBoard] updateQueueNumber 실패", err);
      const message =
        err instanceof Error ? err.message : "순번 변경에 실패했습니다.";
      window.alert(message);
      void loadQueues({ silent: true });
    } finally {
      setRenumberingId(null);
    }
  }

  async function handleSendToPos(entry: QueueEntry) {
    const order = entry.activeOrder;
    if (!order || order.status !== "shopping" || order.items.length === 0) {
      window.alert("장바구니가 비어 있거나 이미 포스기로 전달된 주문입니다.");
      return;
    }

    const soldOutItems = order.items.filter((item) => {
      const storage = storageByProduct.get(item.productId);
      return storage === 0;
    });
    if (soldOutItems.length > 0) {
      window.alert(
        `품절된 상품이 있어 포스기로 넘길 수 없습니다.\n(${soldOutItems
          .map((item) => item.productName)
          .join(", ")})\n손님에게 해당 품목 삭제를 안내해 주세요.`
      );
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
    <main className="relative mx-auto flex min-h-[calc(100vh-4.5rem)] w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
      <header className="mb-5 shrink-0">
        <p className="text-sm font-medium tracking-wide text-sky-600">
          SpaceShop Staff
        </p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
          스마트 컨시어지
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          장바구니를 확인한 뒤 포스기로 넘겨 주세요.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:gap-8">
        {/* 좌측: 안내 + 소형 QR */}
        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-56 xl:w-64">
          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-center text-xs leading-relaxed text-gray-500">
              스마트폰 카메라로 스캔하여
              <br />
              대기열에 등록해 주세요.
            </p>
            <div className="mx-auto mt-3 flex h-[200px] w-[200px] items-center justify-center">
              {qrSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrSrc}
                  alt="대기열 등록 QR 코드"
                  width={200}
                  height={200}
                  className="h-[200px] w-[200px] object-contain"
                />
              ) : (
                <div className="h-full w-full animate-pulse rounded-xl bg-gray-100" />
              )}
            </div>
            {joinUrl && (
              <p className="mt-3 break-all text-center text-[10px] leading-snug text-gray-300">
                {joinUrl}
              </p>
            )}
          </section>
        </aside>

        {/* 우측: 대기자 리스트 (넓은 영역 + 독립 스크롤) */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:min-h-[calc(100vh-12rem)]">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-3.5">
            <div>
              <h2 className="text-base font-bold text-gray-900">
                대기자 리스트
              </h2>
              <p className="mt-0.5 text-xs text-gray-400">
                입장 승인 · 담기/빼기 즉시 반영 · 포스기 전송
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              LIVE
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
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
              <p className="py-16 text-center text-sm text-gray-400">
                아직 등록된 손님이 없습니다
              </p>
            ) : (
              <div className="space-y-6">
                {(() => {
                  const waitingEntries = entries.filter(
                    (e) => getPhase(e) === "waiting_entry"
                  );
                  const activeEntries = entries.filter(
                    (e) => getPhase(e) !== "waiting_entry"
                  );

                  function renderEntry(entry: QueueEntry) {
                    const phase = getPhase(entry);
                    const items = entry.activeOrder?.items ?? [];
                    const hasSoldOut = items.some(
                      (item) => storageByProduct.get(item.productId) === 0
                    );
                    const canSend =
                      phase === "shopping" &&
                      isEnteredStatus(entry.queueStatus) &&
                      items.length > 0 &&
                      entry.activeOrder?.status === "shopping" &&
                      !hasSoldOut;

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
                              {phase === "waiting_entry" ? (
                                <span className="inline-flex items-center truncate rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                  ⏳ 입장 대기
                                </span>
                              ) : phase === "shopping" ? (
                                <span className="inline-flex items-center truncate rounded-md bg-gray-200/80 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                                  🛒 쇼핑 중
                                </span>
                              ) : (
                                <span className="inline-flex items-center truncate rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                                  💳 결제 대기
                                </span>
                              )}
                            </div>

                            {phase === "waiting_entry" ? (
                              <p className="mt-1 text-xs text-gray-400">
                                메뉴 미리보기 중 · 입장 승인 대기
                              </p>
                            ) : items.length > 0 ? (
                              <ul className="mt-2 space-y-1">
                                {items.map((item) => {
                                  const storage =
                                    storageByProduct.get(item.productId) ??
                                    null;
                                  const soldOut = storage === 0;
                                  const lowStock = storage === 1;
                                  return (
                                    <li
                                      key={
                                        item.id ||
                                        `${item.productId}-${item.productName}`
                                      }
                                      className="flex items-start gap-1.5 text-xs leading-snug text-gray-600"
                                    >
                                      <span className="mt-0.5 text-gray-300">
                                        ·
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span
                                          className={[
                                            "font-medium",
                                            soldOut
                                              ? "text-red-700 line-through"
                                              : "text-gray-700",
                                          ].join(" ")}
                                        >
                                          {item.productName}
                                        </span>
                                        <span className="text-gray-400">
                                          {" "}
                                          ({item.quantity}개)
                                        </span>
                                        {soldOut && (
                                          <span className="ml-1.5 inline-flex align-middle rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                            🚨 방금 품절됨
                                          </span>
                                        )}
                                        {!soldOut && lowStock && (
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
                            {hasSoldOut && phase === "shopping" && (
                              <p className="mt-2 text-[11px] font-semibold text-red-600">
                                품절 품목 삭제 후 포스기 전송 가능
                              </p>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-2">
                            {phase === "waiting_entry" && (
                              <button
                                type="button"
                                disabled={admittingId === entry.id}
                                onClick={() => void handleAdmitEntry(entry)}
                                className="rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap text-white hover:bg-sky-500 disabled:bg-slate-300"
                              >
                                {admittingId === entry.id
                                  ? "승인 중…"
                                  : "입장 시키기"}
                              </button>
                            )}
                            {phase === "shopping" &&
                              isEnteredStatus(entry.queueStatus) &&
                              items.length > 0 &&
                              entry.activeOrder?.status === "shopping" && (
                                <button
                                  type="button"
                                  disabled={!canSend || sendingId === entry.id}
                                  onClick={() => void handleSendToPos(entry)}
                                  className="rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-bold whitespace-nowrap text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                                >
                                  {sendingId === entry.id
                                    ? "전송 중…"
                                    : "포스기로 넘기기"}
                                </button>
                              )}
                            <button
                              type="button"
                              disabled={renumberingId === entry.id}
                              onClick={() => void handleChangeQueueNumber(entry)}
                              className="text-[11px] font-medium text-gray-400 transition hover:text-sky-600 disabled:opacity-40"
                              title="순번 변경"
                            >
                              {renumberingId === entry.id
                                ? "변경 중…"
                                : "✏️ 순번 변경"}
                            </button>
                            <button
                              type="button"
                              disabled={deletingId === entry.id}
                              onClick={() => void handleDeleteEntry(entry)}
                              className="flex h-6 w-6 items-center justify-center rounded text-gray-300 transition hover:text-gray-400 disabled:opacity-30"
                              aria-label={`${entry.customerName} 대기열 삭제`}
                              title="삭제"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                className="h-3.5 w-3.5"
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
                  }

                  return (
                    <>
                      {waitingEntries.length > 0 && (
                        <section>
                          <h3 className="mb-2 px-1 text-xs font-bold tracking-wide text-amber-700">
                            ⏳ 입장 대기 ({waitingEntries.length})
                          </h3>
                          <ul className="space-y-2.5">
                            {waitingEntries.map(renderEntry)}
                          </ul>
                        </section>
                      )}
                      {activeEntries.length > 0 && (
                        <section>
                          <h3 className="mb-2 px-1 text-xs font-bold tracking-wide text-gray-600">
                            🛒 쇼핑·결제 ({activeEntries.length})
                          </h3>
                          <ul className="space-y-2.5">
                            {activeEntries.map(renderEntry)}
                          </ul>
                        </section>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Footer — 레이아웃 바깥, 평범한 연한 글씨로 은닉 */}
      <footer className="mt-8 shrink-0 border-t border-transparent pt-4 pb-1 text-center">
        <button
          type="button"
          disabled={clearingAll}
          onClick={() => void handleClearAll()}
          className="text-xs font-normal text-gray-200 transition hover:text-gray-300 disabled:opacity-40"
          title="테스트 데이터 전체 초기화"
        >
          {clearingAll ? "…" : "테스트 데이터 전체 초기화"}
        </button>
      </footer>
    </main>
  );
}
