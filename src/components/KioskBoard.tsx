"use client";

import { useEffect, useMemo, useState } from "react";
import ToastStack, { useToasts } from "@/components/ToastStack";
import { useEventDay } from "@/hooks/useEventDay";
import { fetchInventoryDashboardData } from "@/lib/fetchInventory";
import { checkoutKioskCart } from "@/lib/inventoryActions";
import {
  getBrandInitialKey,
  sortInitialKeys,
} from "@/lib/koreanInitial";
import {
  clearAllSmartOrderTestData,
  completePosPayment,
  deleteOrderAndQueue,
  fetchPendingPosOrders,
  loadSmartOrderForKiosk,
  SMART_ORDER_TRUNCATE_HINT,
  type PendingPosOrder,
} from "@/lib/orderActions";
import { subscribeOrdersRealtime, getDeletedOrderId } from "@/lib/realtimeOrders";
import { supabase } from "@/lib/supabase";
import type { CompanyFilter, DashboardRow } from "@/types/dashboard";

type CartItem = {
  id: string;
  name: string;
  brand: string;
  price: number;
  qty: number;
  maxQty: number;
};

type ViewMode = "grid" | "list";

const COMPANY_FILTERS: CompanyFilter[] = ["전체", "자사", "타사"];

function formatPrice(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function orderItemCount(order: PendingPosOrder): number {
  return order.items.reduce((sum, item) => sum + (item.quantity || 0), 0);
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M16.5 4.478v.227a48.816 48.816 0 0 1 3.878.512.75.75 0 1 1-.256 1.478l-.209-.035-1.005 12.054A3 3 0 0 1 15.916 21H8.084a3 3 0 0 1-2.992-2.786L4.087 6.66l-.209.035a.75.75 0 0 1-.256-1.478A48.567 48.567 0 0 1 7.5 4.705v-.227c0-1.564 1.213-2.927 2.71-3.346A48.788 48.788 0 0 1 12 1.5c1.276 0 2.54.078 3.79.233 1.497.419 2.71 1.782 2.71 3.346ZM6.844 6.75l.948 11.368a1.5 1.5 0 0 0 1.492 1.382h7.432a1.5 1.5 0 0 0 1.492-1.382l.948-11.368H6.844ZM9.75 9a.75.75 0 0 1 .75.75v6.75a.75.75 0 0 1-1.5 0V9.75A.75.75 0 0 1 9.75 9Zm4.5 0a.75.75 0 0 1 .75.75v6.75a.75.75 0 0 1-1.5 0V9.75a.75.75 0 0 1 .75-.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CartPanel({
  cart,
  totalQty,
  totalPrice,
  checkingOut,
  showClose,
  onClose,
  onChangeQty,
  onRemove,
  onCheckout,
  smartOrderLabel,
  onClearSmartOrder,
  pendingOrders,
  acceptingOrderId,
  deletingOrderId,
  activeSmartOrderId,
  onAcceptOrder,
  onDeleteOrder,
}: {
  cart: CartItem[];
  totalQty: number;
  totalPrice: number;
  checkingOut: boolean;
  showClose?: boolean;
  onClose?: () => void;
  onChangeQty: (id: string, delta: number) => void;
  onRemove: (id: string) => void;
  onCheckout: () => void;
  smartOrderLabel?: string | null;
  onClearSmartOrder?: () => void;
  pendingOrders: PendingPosOrder[];
  acceptingOrderId: string | null;
  deletingOrderId: string | null;
  activeSmartOrderId: string | null;
  onAcceptOrder: (order: PendingPosOrder) => void;
  onDeleteOrder: (order: PendingPosOrder) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* 고정형 스마트 오더 대기열 */}
      <section className="flex max-h-[40%] min-h-[10.5rem] flex-col border-b border-slate-200">
        <div className="flex items-center justify-between px-4 py-2.5">
          <div>
            <h2 className="text-sm font-bold text-slate-900 sm:text-base">
              스마트 오더 대기열
            </h2>
            <p className="text-[11px] text-slate-500">
              pending · 순번 오름차순
              {pendingOrders.length > 0 ? ` · ${pendingOrders.length}건` : ""}
            </p>
          </div>
          {showClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              닫기
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {pendingOrders.length === 0 ? (
            <div className="flex h-full min-h-[4.5rem] items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 text-center text-xs text-slate-400">
              대기 중인 스마트 오더가 없습니다
            </div>
          ) : (
            <ul className="space-y-1.5">
              {pendingOrders.map((order) => {
                const isActive = activeSmartOrderId === order.id;
                const qty = orderItemCount(order);
                return (
                  <li
                    key={order.id}
                    className={[
                      "flex items-center gap-2 rounded-xl border px-2.5 py-2",
                      isActive
                        ? "border-sky-200 bg-sky-50"
                        : "border-slate-100 bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {order.queueNumber}번 {order.customerName}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        품목 {order.items.length}종 · {qty}개
                        {isActive ? " · 장바구니 로드됨" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={
                        acceptingOrderId === order.id || isActive || checkingOut
                      }
                      onClick={() => onAcceptOrder(order)}
                      className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      {acceptingOrderId === order.id
                        ? "불러오는 중…"
                        : isActive
                          ? "로드됨"
                          : "불러오기"}
                    </button>
                    <button
                      type="button"
                      disabled={deletingOrderId === order.id}
                      onClick={() => onDeleteOrder(order)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                      aria-label="주문 삭제"
                      title="삭제"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 현재 장바구니 */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          <div>
            <h2 className="text-sm font-bold text-slate-900 sm:text-base">
              현재 장바구니
            </h2>
            <p className="text-[11px] text-slate-500">
              {smartOrderLabel
                ? `스마트 오더 · ${smartOrderLabel}`
                : cart.length === 0
                  ? "담긴 제품이 없습니다"
                  : `${cart.length}종류 · 샵 재고에서 차감`}
            </p>
          </div>
        </div>

        {smartOrderLabel && (
          <div className="flex items-center justify-between gap-2 border-b border-sky-100 bg-sky-50 px-4 py-2">
            <p className="text-xs font-semibold text-sky-800">
              {smartOrderLabel} 주문서 로드됨
            </p>
            {onClearSmartOrder && (
              <button
                type="button"
                onClick={onClearSmartOrder}
                className="text-xs font-semibold text-sky-600 underline"
              >
                해제
              </button>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {cart.length === 0 ? (
            <div className="flex h-full min-h-[6rem] items-center justify-center text-sm text-slate-400">
              대기열에서 불러오거나 제품을 담아 주세요
            </div>
          ) : (
            <ul className="space-y-2">
              {cart.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-slate-400">
                        {item.brand}
                      </p>
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {item.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatPrice(item.price)}원 · 최대 {item.maxQty}개
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(item.id)}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      삭제
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="inline-flex items-center gap-1 rounded-lg bg-white p-0.5 shadow-sm">
                      <button
                        type="button"
                        onClick={() => onChangeQty(item.id, -1)}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-lg font-bold text-slate-700 hover:bg-slate-100"
                        aria-label="수량 감소"
                      >
                        −
                      </button>
                      <span className="min-w-[2rem] text-center text-base font-bold tabular-nums text-slate-900">
                        {item.qty}
                      </span>
                      <button
                        type="button"
                        onClick={() => onChangeQty(item.id, 1)}
                        disabled={item.qty >= item.maxQty}
                        className="flex h-9 w-9 items-center justify-center rounded-md text-lg font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                        aria-label="수량 증가"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-sm font-bold tabular-nums text-slate-900">
                      {formatPrice(item.price * item.qty)}원
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
          <div className="mb-1 flex items-end justify-between">
            <span className="text-sm font-medium text-slate-600">총 수량</span>
            <span className="text-xl font-bold tabular-nums text-slate-900">
              {totalQty}
              <span className="ml-0.5 text-sm font-semibold text-slate-500">
                개
              </span>
            </span>
          </div>
          <div className="mb-4 flex items-end justify-between">
            <span className="text-sm font-medium text-slate-600">
              총 결제 금액
            </span>
            <span className="text-2xl font-bold tabular-nums text-sky-700 sm:text-3xl">
              {formatPrice(totalPrice)}
              <span className="ml-0.5 text-base font-semibold">원</span>
            </span>
          </div>

          <button
            type="button"
            disabled={cart.length === 0 || checkingOut}
            onClick={onCheckout}
            className="flex w-full items-center justify-center rounded-2xl bg-emerald-600 px-4 py-4 text-lg font-bold text-white shadow-md transition hover:bg-emerald-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            {checkingOut ? "결제 처리 중..." : "결제 완료"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function KioskBoard() {
  const { eventDay } = useEventDay();
  const { toasts, pushToast, dismissToast } = useToasts();
  const [products, setProducts] = useState<DashboardRow[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>("전체");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedInitial, setSelectedInitial] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [pendingOrders, setPendingOrders] = useState<PendingPosOrder[]>([]);
  const [activeSmartOrderId, setActiveSmartOrderId] = useState<string | null>(
    null
  );
  const [activeSmartLabel, setActiveSmartLabel] = useState<string | null>(null);
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  async function loadProducts(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const data = await fetchInventoryDashboardData(eventDay, {
        orderBy: "created",
      });
      setProducts(data.rows);
      setCart((prev) =>
        prev
          .map((item) => {
            const row = data.rows.find((r) => r.id === item.id);
            if (!row) return null;
            const maxQty = row.storageQty;
            if (maxQty <= 0) return null;
            return {
              ...item,
              maxQty,
              price: row.price,
              qty: Math.min(item.qty, maxQty),
            };
          })
          .filter((item): item is CartItem => item != null)
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "제품 목록을 불러오지 못했습니다.";
      console.error(err);
      if (!options?.silent) setError(message);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventDay]);

  // 스마트 오더 pending 고정 리스트 + Realtime (paid 되면 목록에서 사라짐)
  useEffect(() => {
    if (typeof window === "undefined") return;

    let debounceTimer: number | null = null;
    let pollTimer: number | null = null;
    let disposed = false;

    async function refreshPendingOrders() {
      try {
        const pending = await fetchPendingPosOrders();
        if (!disposed) setPendingOrders(pending);
      } catch (err) {
        console.error("[KioskBoard] pending 대기열 목록 실패", err);
      }
    }

    const scheduleRefresh = () => {
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      // order INSERT 직후 order_items INSERT가 이어지므로 짧게 디바운스
      debounceTimer = window.setTimeout(() => {
        void refreshPendingOrders();
      }, 220);
    };

    void refreshPendingOrders();

    const unsubscribe = subscribeOrdersRealtime({
      channelPrefix: "kiosk-orders",
      includeOrderItems: true,
      onChange: (payload) => {
        // 손님 주문 수정(DELETE) 시 대기열에서 즉시 제거
        const deletedId = getDeletedOrderId(payload);
        if (deletedId) {
          setPendingOrders((prev) =>
            prev.filter((row) => row.id !== deletedId)
          );
          setActiveSmartOrderId((current) => {
            if (current !== deletedId) return current;
            setActiveSmartLabel(null);
            setCart([]);
            return null;
          });
          return;
        }
        scheduleRefresh();
      },
    });

    // Realtime 미설정/지연 대비 가벼운 폴링 백업
    pollTimer = window.setInterval(() => {
      void refreshPendingOrders();
    }, 8000);

    return () => {
      disposed = true;
      if (debounceTimer != null) window.clearTimeout(debounceTimer);
      if (pollTimer != null) window.clearInterval(pollTimer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let timer: number | null = null;

    const channel = supabase
      .channel("realtime:kiosk-inventory")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory" },
        (payload) => {
          const next = (payload.new ?? {}) as {
            product_id?: string;
            storage_qty?: number | string | null;
            backup_qty?: number | string | null;
          };
          const productId = String(next.product_id ?? "");
          if (!productId) {
            if (timer != null) window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              void loadProducts({ silent: true });
            }, 120);
            return;
          }

          const storageQty = toNumber(next.storage_qty);
          const backupQty = toNumber(next.backup_qty);

          setProducts((prev) =>
            prev.map((row) =>
              row.id === productId
                ? {
                    ...row,
                    storageQty,
                    backupQty,
                    totalQty: storageQty + backupQty,
                  }
                : row
            )
          );

          setCart((prev) =>
            prev
              .map((item) => {
                if (item.id !== productId) return item;
                if (storageQty <= 0) return null;
                return {
                  ...item,
                  maxQty: storageQty,
                  qty: Math.min(item.qty, storageQty),
                };
              })
              .filter((item): item is CartItem => item != null)
          );
        }
      )
      .subscribe();

    return () => {
      if (timer != null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const companyFiltered = useMemo(() => {
    if (companyFilter === "전체") return products;
    return products.filter((row) => row.companyType === companyFilter);
  }, [products, companyFilter]);

  const availableInitials = useMemo(() => {
    const keys = new Set<string>();
    for (const row of companyFiltered) {
      const key = getBrandInitialKey(row.brand);
      if (key) keys.add(key);
    }
    return sortInitialKeys(keys);
  }, [companyFiltered]);

  const brandsForInitial = useMemo(() => {
    if (!selectedInitial) return [];
    const seen = new Set<string>();
    const brands: string[] = [];
    for (const row of companyFiltered) {
      if (getBrandInitialKey(row.brand) !== selectedInitial) continue;
      if (seen.has(row.brand)) continue;
      seen.add(row.brand);
      brands.push(row.brand);
    }
    return brands;
  }, [companyFiltered, selectedInitial]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return companyFiltered.filter((row) => {
      if (selectedInitial && getBrandInitialKey(row.brand) !== selectedInitial) {
        return false;
      }
      if (selectedBrand && row.brand !== selectedBrand) {
        return false;
      }
      if (!keyword) return true;
      return (
        row.name.toLowerCase().includes(keyword) ||
        row.brand.toLowerCase().includes(keyword)
      );
    });
  }, [companyFiltered, search, selectedInitial, selectedBrand]);

  function clearSearchAndFilters() {
    setSearch("");
    setSelectedInitial(null);
    setSelectedBrand(null);
  }

  function handleSelectInitial(initial: string) {
    setSelectedBrand(null);
    setSelectedInitial((prev) => (prev === initial ? null : initial));
  }

  function handleSelectBrand(brand: string) {
    setSelectedBrand((prev) => (prev === brand ? null : brand));
  }

  function handleCompanyFilterChange(filter: CompanyFilter) {
    setCompanyFilter(filter);
    setSelectedInitial(null);
    setSelectedBrand(null);
  }

  const totalQty = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty, 0),
    [cart]
  );
  const totalPrice = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    [cart]
  );

  function addToCart(row: DashboardRow) {
    if (row.storageQty <= 0) return;

    let blocked = false;
    setCart((prev) => {
      const existing = prev.find((item) => item.id === row.id);
      if (existing) {
        if (existing.qty >= existing.maxQty) {
          blocked = true;
          return prev;
        }
        return prev.map((item) =>
          item.id === row.id ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [
        ...prev,
        {
          id: row.id,
          name: row.name,
          brand: row.brand,
          price: row.price,
          qty: 1,
          maxQty: row.storageQty,
        },
      ];
    });

    if (blocked) {
      pushToast("재고 수량을 초과할 수 없습니다", "danger");
    }
  }

  function changeQty(id: string, delta: number) {
    let blocked = false;
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== id) return item;
          const nextQty = item.qty + delta;
          if (nextQty <= 0) return null;
          if (nextQty > item.maxQty) {
            blocked = true;
            return item;
          }
          return { ...item, qty: nextQty };
        })
        .filter((item): item is CartItem => item != null)
    );
    if (blocked) {
      pushToast("재고 수량을 초과할 수 없습니다", "danger");
    }
  }

  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((item) => item.id !== id));
  }

  function clearSmartOrder() {
    setActiveSmartOrderId(null);
    setActiveSmartLabel(null);
    setCart([]);
  }

  function extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === "object" && err != null) {
      const maybe = err as { message?: unknown; error_description?: unknown };
      if (typeof maybe.message === "string" && maybe.message.trim()) {
        return maybe.message;
      }
      if (
        typeof maybe.error_description === "string" &&
        maybe.error_description.trim()
      ) {
        return maybe.error_description;
      }
    }
    if (typeof err === "string" && err.trim()) return err;
    return fallback;
  }

  async function acceptSmartOrder(order: PendingPosOrder) {
    if (acceptingOrderId) return;
    if (
      cart.length > 0 &&
      activeSmartOrderId &&
      activeSmartOrderId !== order.id
    ) {
      const ok = window.confirm(
        "현재 장바구니에 다른 스마트 오더가 있습니다. 덮어쓰시겠습니까?"
      );
      if (!ok) return;
    }

    setAcceptingOrderId(order.id);
    try {
      const { order: detail, cartItems } = await loadSmartOrderForKiosk(
        order.id
      );
      if (cartItems.length === 0) {
        pushToast("주문 품목이 비어 있습니다", "danger");
        return;
      }

      // 로컬 인벤토리(products)와 병합해 키오스크 CartItem 규격에 맞춤
      const nextCart: CartItem[] = cartItems.map((item) => {
        const row = products.find((p) => p.id === item.id);
        const maxQty = Math.max(
          row?.storageQty ?? 0,
          item.maxQty,
          item.qty,
          1
        );
        return {
          id: item.id,
          name: row?.name || item.name,
          brand: row?.brand || item.brand,
          price: row?.price ?? item.price,
          qty: Math.min(item.qty, maxQty),
          maxQty,
        };
      });

      setCart(nextCart);
      setActiveSmartOrderId(detail.id);
      setActiveSmartLabel(`${detail.queueNumber}번 ${detail.customerName}`);
      setIsCartOpen(true);
      pushToast(
        `스마트 오더 ${detail.queueNumber}번 · ${detail.customerName} 불러옴`,
        "success"
      );
    } catch (err) {
      console.error("[KioskBoard] acceptSmartOrder failed", err);
      const message = extractErrorMessage(
        err,
        "스마트 오더를 불러오지 못했습니다."
      );
      pushToast(`불러오기 실패: ${message}`, "danger");
      window.alert(`불러오기 실패: ${message}`);
    } finally {
      setAcceptingOrderId(null);
    }
  }

  async function handleDeleteOrder(order: PendingPosOrder) {
    const ok = window.confirm(
      "이 대기열/주문 내역을 정말 삭제하시겠습니까?"
    );
    if (!ok) return;

    setDeletingOrderId(order.id);
    try {
      await deleteOrderAndQueue(order.id);
      setPendingOrders((prev) => prev.filter((row) => row.id !== order.id));
      if (activeSmartOrderId === order.id) {
        clearSmartOrder();
      }
      pushToast("주문 내역을 삭제했습니다", "success");
    } catch (err) {
      console.error("[KioskBoard] deleteOrder failed", err);
      const message = extractErrorMessage(err, "삭제에 실패했습니다.");
      pushToast(message, "danger");
    } finally {
      setDeletingOrderId(null);
    }
  }

  async function handleClearAllTestData() {
    const ok = window.confirm(
      "경고: 현재 쌓여있는 모든 대기열과 주문 내역이 완전히 삭제됩니다. 실전 행사 중이라면 절대 누르지 마세요. 계속하시겠습니까?"
    );
    if (!ok) return;

    setClearingAll(true);
    try {
      await clearAllSmartOrderTestData();
      clearSmartOrder();
      setPendingOrders([]);
      window.location.reload();
    } catch (err) {
      console.error("[KioskBoard] clearAllTestData failed", err);
      const message = extractErrorMessage(err, SMART_ORDER_TRUNCATE_HINT);
      window.alert(message);
    } finally {
      setClearingAll(false);
    }
  }

  async function handleCheckout() {
    if (cart.length === 0 || checkingOut) return;

    // 결제 직전 스냅샷 — Realtime 재고 이벤트가 cart를 건드리지 못하게 고정
    const cartSnapshot = cart.map((item) => ({
      productId: item.id,
      quantity: item.qty,
      unitPrice: item.price,
      productName: item.name,
    }));

    setCheckingOut(true);
    try {
      if (activeSmartOrderId) {
        const paidOrderId = activeSmartOrderId;
        // 수기 추가 포함 — 화면 최종 장바구니 전체를 백엔드에 전달
        await completePosPayment(paidOrderId, eventDay, cartSnapshot);
        const label = activeSmartLabel ?? "스마트 오더";
        // 결제 후 장바구니·스마트 오더 상태 초기화 → 다음 대기열 준비
        setCart([]);
        setActiveSmartOrderId(null);
        setActiveSmartLabel(null);
        setPendingOrders((prev) =>
          prev.filter((row) => row.id !== paidOrderId)
        );
        setIsCartOpen(false);
        pushToast(`✅ ${label} 결제 완료!`, "success");
      } else {
        await checkoutKioskCart({
          dayNumber: eventDay,
          items: cartSnapshot,
        });

        const count = cartSnapshot.length;
        setCart([]);
        setIsCartOpen(false);
        pushToast(`✅ 총 ${count}건 결제 완료!`, "success");
      }
      void loadProducts({ silent: true });
    } catch (err) {
      console.error("[KioskBoard] checkout failed", err);
      const message = extractErrorMessage(err, "결제 처리에 실패했습니다.");
      alert(message);
      void loadProducts({ silent: true });
    } finally {
      setCheckingOut(false);
    }
  }

  const cartPanelProps = {
    cart,
    totalQty,
    totalPrice,
    checkingOut,
    onChangeQty: changeQty,
    onRemove: removeFromCart,
    onCheckout: () => void handleCheckout(),
    smartOrderLabel: activeSmartLabel,
    onClearSmartOrder: clearSmartOrder,
    pendingOrders,
    acceptingOrderId,
    deletingOrderId,
    activeSmartOrderId,
    onAcceptOrder: (order: PendingPosOrder) => void acceptSmartOrder(order),
    onDeleteOrder: (order: PendingPosOrder) => void handleDeleteOrder(order),
  };

  return (
    <div className="relative mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-4 lg:px-6">
      <div className="flex gap-4 md:h-[calc(100vh-8rem)]">
        {/* 제품 영역 */}
        <section className="flex min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:w-[65%]">
          <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
                  키오스크
                </h1>
                <p className="text-xs text-slate-500">
                  제품을 터치해 장바구니에 담으세요 · {eventDay}일차
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={clearingAll}
                  onClick={() => void handleClearAllTestData()}
                  className="rounded-lg border border-red-200 px-2.5 py-1.5 text-[11px] font-medium text-red-500 hover:bg-red-50 disabled:opacity-50"
                >
                  {clearingAll ? "초기화 중…" : "테스트 데이터 전체 초기화"}
                </button>
                <div className="relative w-full max-w-xs sm:w-56">
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="브랜드·제품 검색"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-10 pl-3 text-sm outline-none focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
                />
                {(search || selectedInitial || selectedBrand) && (
                  <button
                    type="button"
                    onClick={clearSearchAndFilters}
                    className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                    aria-label="검색·필터 초기화"
                  >
                    ✕
                  </button>
                )}
              </div>
              </div>
            </div>

            {/* 컨트롤 바 */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                {COMPANY_FILTERS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => handleCompanyFilterChange(filter)}
                    className={[
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:px-3.5 sm:text-sm",
                      companyFilter === filter
                        ? "bg-sky-600 text-white shadow-sm"
                        : "text-slate-600 hover:text-slate-900",
                    ].join(" ")}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm",
                    viewMode === "grid"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900",
                  ].join(" ")}
                >
                  <span aria-hidden>⊞</span>
                  그리드
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm",
                    viewMode === "list"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900",
                  ].join(" ")}
                >
                  <span aria-hidden>☰</span>
                  목록
                </button>
              </div>
            </div>

            {/* 1단계: 초성 */}
            {availableInitials.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {availableInitials.map((initial) => (
                  <button
                    key={initial}
                    type="button"
                    onClick={() => handleSelectInitial(initial)}
                    className={[
                      "min-w-9 rounded-lg px-2.5 py-1.5 text-sm font-bold transition",
                      selectedInitial === initial
                        ? "bg-sky-600 text-white shadow-sm"
                        : "bg-slate-100 text-slate-700 hover:bg-sky-50 hover:text-sky-700",
                    ].join(" ")}
                  >
                    {initial}
                  </button>
                ))}
              </div>
            )}

            {/* 2단계: 브랜드 */}
            {selectedInitial && brandsForInitial.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {brandsForInitial.map((brand) => (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => handleSelectBrand(brand)}
                    className={[
                      "rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm",
                      selectedBrand === brand
                        ? "bg-sky-600 text-white shadow-sm"
                        : "border border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50",
                    ].join(" ")}
                  >
                    {brand}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-28 sm:p-4 md:pb-4">
            {error && (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </div>
            )}

            {loading ? (
              viewMode === "grid" ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 12 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-36 animate-pulse rounded-2xl bg-slate-100"
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-14 animate-pulse rounded-xl bg-slate-100"
                    />
                  ))}
                </div>
              )
            ) : filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-500">
                표시할 제품이 없습니다
              </p>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((row) => {
                  const soldOut = row.storageQty <= 0;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      disabled={soldOut}
                      onClick={() => addToCart(row)}
                      className={[
                        "rounded-2xl border p-4 text-left transition active:scale-[0.98]",
                        soldOut
                          ? "cursor-not-allowed border-slate-100 bg-slate-100 opacity-55"
                          : "border-slate-200 bg-white shadow-sm hover:border-sky-300 hover:bg-sky-50/60",
                      ].join(" ")}
                    >
                      <p className="text-xs font-medium text-slate-400 sm:text-sm">
                        {row.brand}
                      </p>
                      <p
                        className={[
                          "mt-1 line-clamp-2 text-base font-bold leading-snug sm:text-lg",
                          soldOut ? "text-slate-500" : "text-slate-900",
                        ].join(" ")}
                      >
                        {row.name}
                      </p>
                      <p
                        className={[
                          "mt-3 text-lg font-bold tabular-nums sm:text-xl",
                          soldOut ? "text-slate-400" : "text-sky-700",
                        ].join(" ")}
                      >
                        {formatPrice(row.price)}원
                      </p>
                      <p
                        className={[
                          "mt-1 text-sm font-semibold",
                          soldOut ? "text-slate-400" : "text-slate-600",
                        ].join(" ")}
                      >
                        {soldOut ? "품절" : `잔여 ${row.storageQty}개`}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <ul className="space-y-2">
                {filtered.map((row) => {
                  const soldOut = row.storageQty <= 0;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        disabled={soldOut}
                        onClick={() => addToCart(row)}
                        className={[
                          "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition active:scale-[0.99] sm:px-4",
                          soldOut
                            ? "cursor-not-allowed border-slate-100 bg-slate-100 opacity-55"
                            : "border-slate-200 bg-white shadow-sm hover:border-sky-300 hover:bg-sky-50/50",
                        ].join(" ")}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-900">
                            <span className="font-medium text-slate-400">
                              [{row.brand}]
                            </span>{" "}
                            <span className="font-semibold">{row.name}</span>
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p
                            className={[
                              "text-sm font-bold tabular-nums sm:text-base",
                              soldOut ? "text-slate-400" : "text-sky-700",
                            ].join(" ")}
                          >
                            {formatPrice(row.price)}원
                          </p>
                          <p
                            className={[
                              "text-xs font-semibold",
                              soldOut ? "text-slate-400" : "text-slate-500",
                            ].join(" ")}
                          >
                            {soldOut ? "품절" : `잔여: ${row.storageQty}개`}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* 데스크탑/태블릿: 항상 보이는 장바구니 */}
        <aside className="hidden min-h-0 w-[35%] overflow-hidden rounded-2xl border border-slate-200 shadow-sm md:flex md:flex-col">
          <CartPanel {...cartPanelProps} />
        </aside>
      </div>

      {/* 모바일: Backdrop + Drawer */}
      {isCartOpen && (
        <button
          type="button"
          aria-label="장바구니 닫기"
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setIsCartOpen(false)}
        />
      )}

      <aside
        className={[
          "fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out sm:w-96 md:hidden",
          isCartOpen
            ? "translate-x-0"
            : "pointer-events-none translate-x-full",
        ].join(" ")}
        aria-hidden={!isCartOpen}
      >
        <CartPanel
          {...cartPanelProps}
          showClose
          onClose={() => setIsCartOpen(false)}
        />
      </aside>

      {/* 모바일 FAB */}
      <button
        type="button"
        onClick={() => setIsCartOpen((prev) => !prev)}
        className="fixed right-8 bottom-8 z-[45] flex h-16 w-16 items-center justify-center rounded-full bg-sky-600 text-white shadow-xl transition hover:bg-sky-500 active:scale-95 md:hidden"
        aria-label="장바구니 열기"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-7 w-7"
          aria-hidden
        >
          <path d="M2.25 2.25a.75.75 0 0 0 0 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a2.25 2.25 0 0 0 2.172 1.68h8.887a.75.75 0 0 0 0-1.5H8.728a.75.75 0 0 1-.724-.56l-.24-.9h9.51a2.25 2.25 0 0 0 2.205-1.755l1.32-5.94a.75.75 0 0 0-.727-.91H6.112L5.38 2.722A1.875 1.875 0 0 0 3.636 1.5H2.25Z" />
          <path d="M8.25 19.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM18.75 19.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
        </svg>
        {totalQty > 0 && (
          <span className="absolute -top-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-rose-500 px-1.5 text-xs font-bold text-white shadow">
            {totalQty > 99 ? "99+" : totalQty}
          </span>
        )}
      </button>

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
