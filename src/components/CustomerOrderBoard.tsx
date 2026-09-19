"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchInventoryDashboardData } from "@/lib/fetchInventory";
import { getBrandInitialKey, KOREAN_INITIALS } from "@/lib/koreanInitial";
import {
  cancelPendingOrderByQueue,
  fetchPendingQtyByProduct,
  getAvailableQty,
  submitCustomerOrder,
  type CartItem,
} from "@/lib/orderActions";
import {
  subscribeOrdersRealtime,
} from "@/lib/realtimeOrders";
import { supabase } from "@/lib/supabase";
import type { DashboardRow } from "@/types/dashboard";

type CompanyFilterValue = "전체" | "자사" | "타사";
type LiquorFilterValue =
  | "전체"
  | "위스키"
  | "브랜디"
  | "럼"
  | "리큐르"
  | "기타";
type InitialFilterValue = "전체" | "A-Z" | (typeof KOREAN_INITIALS)[number];

type BrandGroup = {
  brand: string;
  products: DashboardRow[];
  totalCount: number;
  soldOutCount: number;
};

type CompanyGroup = {
  companyType: string;
  label: string;
  brands: BrandGroup[];
  totalCount: number;
  soldOutCount: number;
};

const COMPANY_PILLS: Array<{ value: CompanyFilterValue; label: string }> = [
  { value: "전체", label: "전체 보기" },
  { value: "자사", label: "스페이스 컴퍼니 코리아" },
  { value: "타사", label: "타사 제품" },
];

const LIQUOR_PILLS: Array<{ value: LiquorFilterValue; label: string }> = [
  { value: "전체", label: "전체 주종" },
  { value: "위스키", label: "위스키" },
  { value: "브랜디", label: "브랜디" },
  { value: "럼", label: "럼" },
  { value: "리큐르", label: "리큐르" },
  { value: "기타", label: "기타" },
];

const INITIAL_PILLS: Array<{ value: InitialFilterValue; label: string }> = [
  { value: "전체", label: "전체" },
  ...KOREAN_INITIALS.map((cho) => ({
    value: cho as InitialFilterValue,
    label: cho,
  })),
  { value: "A-Z", label: "A-Z" },
];

const KNOWN_LIQUOR_TYPES = new Set<string>([
  "위스키",
  "브랜디",
  "럼",
  "리큐르",
  "기타",
]);

const COMPANY_LABELS: Record<string, string> = {
  자사: "스페이스 컴퍼니 코리아",
  타사: "타사 제품",
};

const COMPANY_ORDER = ["자사", "타사"];

const SCROLL_ROW =
  "flex flex-nowrap gap-2 overflow-x-auto whitespace-nowrap pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

const PENDING_WARN =
  "앞선 대기자들의 주문으로 인해 품절될 수 있습니다.";

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatPrice(value: number): string {
  return `${Math.max(0, value).toLocaleString("ko-KR")}원`;
}

function matchesLiquorFilter(
  liquorType: string,
  filter: LiquorFilterValue
): boolean {
  if (filter === "전체") return true;
  if (filter === "기타") {
    if (!liquorType) return true;
    return !KNOWN_LIQUOR_TYPES.has(liquorType) || liquorType === "기타";
  }
  return liquorType === filter;
}

function matchesInitialKey(
  brand: string,
  initial: InitialFilterValue
): boolean {
  if (initial === "전체") return true;
  const key = getBrandInitialKey(brand);
  if (!key) return false;
  if (initial === "A-Z") return /^[A-Z]$/.test(key);
  return key === initial;
}

function companyLabel(companyType: string): string {
  return COMPANY_LABELS[companyType] ?? companyType;
}

function groupFilteredProducts(rows: DashboardRow[]): CompanyGroup[] {
  const byCompany = new Map<string, Map<string, DashboardRow[]>>();

  for (const row of rows) {
    const companyKey = row.companyType || "기타";
    const brandKey = row.brand || "미지정";
    if (!byCompany.has(companyKey)) byCompany.set(companyKey, new Map());
    const brandMap = byCompany.get(companyKey)!;
    if (!brandMap.has(brandKey)) brandMap.set(brandKey, []);
    brandMap.get(brandKey)!.push(row);
  }

  const companyKeys = [
    ...COMPANY_ORDER.filter((key) => byCompany.has(key)),
    ...[...byCompany.keys()]
      .filter((key) => !COMPANY_ORDER.includes(key))
      .sort((a, b) => a.localeCompare(b, "ko")),
  ];

  return companyKeys.map((companyType) => {
    const brandMap = byCompany.get(companyType)!;
    const brandNames = [...brandMap.keys()].sort((a, b) =>
      a.localeCompare(b, "ko")
    );
    const brands: BrandGroup[] = brandNames.map((brand) => {
      const products = brandMap.get(brand)!;
      return {
        brand,
        products,
        totalCount: products.length,
        soldOutCount: products.filter((p) => p.storageQty === 0).length,
      };
    });
    return {
      companyType,
      label: companyLabel(companyType),
      brands,
      totalCount: brands.reduce((s, b) => s + b.totalCount, 0),
      soldOutCount: brands.reduce((s, b) => s + b.soldOutCount, 0),
    };
  });
}

function PillButton({
  label,
  active,
  onClick,
  size = "default",
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  size?: "default" | "tiny";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "shrink-0 rounded-full font-medium whitespace-nowrap transition",
        size === "tiny" ? "min-w-10 px-3 py-2 text-sm" : "px-3 py-2 text-sm",
        active
          ? "bg-gray-900 text-white"
          : "bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

export default function CustomerOrderBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queueId = searchParams.get("queue_id");

  const [products, setProducts] = useState<DashboardRow[]>([]);
  const [pendingByProduct, setPendingByProduct] = useState<Map<string, number>>(
    () => new Map()
  );
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null);
  const [receiptItems, setReceiptItems] = useState<CartItem[]>([]);
  const [isPaid, setIsPaid] = useState(false);
  const [retracting, setRetracting] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);

  const [companyFilter, setCompanyFilter] =
    useState<CompanyFilterValue>("전체");
  const [liquorFilter, setLiquorFilter] = useState<LiquorFilterValue>("전체");
  const [searchTerm, setSearchTerm] = useState("");
  const [initialFilter, setInitialFilter] =
    useState<InitialFilterValue>("전체");
  const [brandFilter, setBrandFilter] = useState<string | null>(null);
  const [brandSearchOpen, setBrandSearchOpen] = useState(false);

  useEffect(() => {
    if (!queueId) {
      router.replace("/");
    }
  }, [queueId, router]);

  useEffect(() => {
    if (typeof window === "undefined" || !queueId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [data, pending] = await Promise.all([
          fetchInventoryDashboardData(undefined, { orderBy: "created" }),
          fetchPendingQtyByProduct(),
        ]);
        if (cancelled) return;
        setProducts(data.rows);
        setPendingByProduct(pending);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "제품 목록을 불러오지 못했습니다.";
        console.error(err);
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [queueId]);

  useEffect(() => {
    if (typeof window === "undefined" || !queueId || submitted) return;

    let timer: number | null = null;

    const channel = supabase
      .channel("realtime:order-inventory")
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
              void Promise.all([
                fetchInventoryDashboardData(undefined, { orderBy: "created" }),
                fetchPendingQtyByProduct(),
              ])
                .then(([data, pending]) => {
                  setProducts(data.rows);
                  setPendingByProduct(pending);
                })
                .catch(console.error);
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
        }
      )
      .subscribe();

    return () => {
      if (timer != null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [queueId, submitted]);

  const brandsForInitial = useMemo(() => {
    const seen = new Set<string>();
    const brands: string[] = [];
    for (const row of products) {
      if (!matchesInitialKey(row.brand, initialFilter)) continue;
      if (seen.has(row.brand)) continue;
      seen.add(row.brand);
      brands.push(row.brand);
    }
    return brands.sort((a, b) => a.localeCompare(b, "ko"));
  }, [products, initialFilter]);

  useEffect(() => {
    if (brandFilter && !brandsForInitial.includes(brandFilter)) {
      setBrandFilter(null);
    }
  }, [brandsForInitial, brandFilter]);

  const filteredProducts = useMemo(() => {
    const keyword = searchTerm.trim().toLowerCase();
    return products.filter((row) => {
      if (companyFilter !== "전체" && row.companyType !== companyFilter) {
        return false;
      }
      if (!matchesLiquorFilter(row.liquorType, liquorFilter)) return false;
      if (brandFilter && row.brand !== brandFilter) return false;
      if (initialFilter !== "전체" && !brandFilter) {
        if (!matchesInitialKey(row.brand, initialFilter)) return false;
      }
      if (keyword) {
        const inName = row.name.toLowerCase().includes(keyword);
        const inBrand = row.brand.toLowerCase().includes(keyword);
        if (!inName && !inBrand) return false;
      }
      return true;
    });
  }, [
    products,
    companyFilter,
    liquorFilter,
    searchTerm,
    brandFilter,
    initialFilter,
  ]);

  const companyGroups = useMemo(
    () => groupFilteredProducts(filteredProducts),
    [filteredProducts]
  );

  const cartItemCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty, 0),
    [cart]
  );

  const cartTotalPrice = useMemo(
    () =>
      cart.reduce((sum, item) => {
        const unit =
          typeof item.price === "number" && Number.isFinite(item.price)
            ? item.price
            : products.find((p) => p.id === item.productId)?.price ?? 0;
        return sum + unit * item.qty;
      }, 0),
    [cart, products]
  );

  async function handleAddToCart(row: DashboardRow) {
    if (submitted || row.storageQty === 0) return;

    setAddingId(row.id);
    try {
      let pendingMap = pendingByProduct;
      try {
        pendingMap = await fetchPendingQtyByProduct();
        setPendingByProduct(pendingMap);
      } catch (err) {
        console.error(err);
      }

      const cartQty = cart.find((item) => item.productId === row.id)?.qty ?? 0;
      const pendingQty = pendingMap.get(row.id) ?? 0;
      const available = getAvailableQty({
        storageQty: row.storageQty,
        pendingQty,
        cartQty,
      });

      if (available < 1) {
        window.alert(PENDING_WARN);
        return;
      }

      setCart((prev) => {
        const existing = prev.find((item) => item.productId === row.id);
        if (existing) {
          return prev.map((item) =>
            item.productId === row.id
              ? {
                  ...item,
                  qty: item.qty + 1,
                  price: item.price ?? row.price,
                }
              : item
          );
        }
        return [
          ...prev,
          {
            productId: row.id,
            name: row.name,
            brand: row.brand,
            qty: 1,
            price: row.price,
          },
        ];
      });
    } finally {
      setAddingId(null);
    }
  }

  async function changeCartQty(productId: string, delta: number) {
    if (submitted || submitting) return;

    const item = cart.find((row) => row.productId === productId);
    if (!item) return;

    const nextQty = item.qty + delta;
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((row) => row.productId !== productId));
      return;
    }

    if (delta > 0) {
      let pendingMap = pendingByProduct;
      try {
        pendingMap = await fetchPendingQtyByProduct();
        setPendingByProduct(pendingMap);
      } catch (err) {
        console.error(err);
      }

      const product = products.find((p) => p.id === productId);
      const storageQty = product?.storageQty ?? 0;
      const pendingQty = pendingMap.get(productId) ?? 0;
      // cartQty를 현재 수량으로 두면 available = storage - pending - current
      // 1개 더 담을 수 있는지: available >= 1
      const available = getAvailableQty({
        storageQty,
        pendingQty,
        cartQty: item.qty,
      });
      if (available < 1) {
        window.alert(PENDING_WARN);
        return;
      }
    }

    setCart((prev) =>
      prev.map((row) =>
        row.productId === productId ? { ...row, qty: nextQty } : row
      )
    );
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((row) => row.productId !== productId));
  }

  async function handleSubmitOrder() {
    if (!queueId || cart.length === 0 || submitting || submitted) return;

    setSubmitting(true);
    try {
      // 제출 직전 전체 재검증
      const pendingMap = await fetchPendingQtyByProduct();
      setPendingByProduct(pendingMap);

      for (const item of cart) {
        const product = products.find((p) => p.id === item.productId);
        const storageQty = product?.storageQty ?? 0;
        const pendingQty = pendingMap.get(item.productId) ?? 0;
        const available = getAvailableQty({
          storageQty,
          pendingQty,
          cartQty: 0,
        });
        if (item.qty > available) {
          window.alert(
            `"${item.name}" — ${PENDING_WARN}`
          );
          setSubmitting(false);
          return;
        }
      }

      const { orderId } = await submitCustomerOrder({ queueId, items: cart });
      setReceiptItems(cart);
      setSubmittedOrderId(orderId);
      window.alert(
        "주문서가 포스기로 전송되었습니다! 카운터로 와주세요."
      );
      // 장바구니는 유지 — 주문 수정 시 이어서 편집 가능
      setSubmitted(true);
      setIsCartOpen(false);
    } catch (err) {
      console.error("[handleSubmitOrder] 제출 실패", err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" &&
              err !== null &&
              "message" in err &&
              typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "알 수 없는 오류";
      window.alert(`제출 실패: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditOrder() {
    if (!queueId || retracting || isPaid) return;

    const ok = window.confirm(
      "제출한 주문서를 취소하고 장바구니를 다시 수정할까요?\n키오스크 대기열에서도 해당 주문이 사라집니다."
    );
    if (!ok) return;

    setRetracting(true);
    try {
      await cancelPendingOrderByQueue(queueId, submittedOrderId);
      // 장바구니 유지 (비어 있으면 제출 시 스냅샷으로 복구)
      setCart((prev) => (prev.length > 0 ? prev : receiptItems));
      setSubmitted(false);
      setSubmittedOrderId(null);
      setIsPaid(false);
    } catch (err) {
      console.error("[CustomerOrderBoard] 주문 수정(취소) 실패", err);
      const message =
        err instanceof Error ? err.message : "주문 취소에 실패했습니다.";
      window.alert(`주문 수정 실패: ${message}`);
    } finally {
      setRetracting(false);
    }
  }

  // 결제 대기 중 — 본인 주문 paid 실시간 감지
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!submitted || !submittedOrderId || isPaid) return;

    let disposed = false;
    let pollTimer: number | null = null;

    const markPaidIfNeeded = (status?: string | null) => {
      if (disposed) return;
      if (status === "paid") setIsPaid(true);
    };

    async function checkPaidOnce() {
      try {
        const { data, error } = await supabase
          .from("orders")
          .select("status")
          .eq("id", submittedOrderId)
          .maybeSingle();
        if (error) {
          console.error("[CustomerOrderBoard] paid 폴링 실패", error);
          return;
        }
        markPaidIfNeeded(data?.status ?? null);
      } catch (err) {
        console.error("[CustomerOrderBoard] paid 폴링 예외", err);
      }
    }

    const unsubscribe = subscribeOrdersRealtime({
      channelPrefix: `order-paid:${submittedOrderId}`,
      orderIdFilter: submittedOrderId,
      onChange: (payload) => {
        const next = (payload.new ?? {}) as {
          id?: string;
          status?: string;
        };
        console.info("[CustomerOrderBoard] orders UPDATE", next);
        if (
          String(next.id ?? submittedOrderId) === submittedOrderId &&
          next.status === "paid"
        ) {
          setIsPaid(true);
        }
      },
    });

    // 이미 paid인지 즉시 1회 확인 (이벤트 놓친 경우)
    void checkPaidOnce();

    // Realtime 미설정/지연 대비 폴링 백업 (결제 완료 시 effect cleanup으로 중단)
    pollTimer = window.setInterval(() => {
      void checkPaidOnce();
    }, 2500);

    return () => {
      disposed = true;
      if (pollTimer != null) window.clearInterval(pollTimer);
      unsubscribe();
    };
  }, [submitted, submittedOrderId, isPaid]);

  if (!queueId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        이동 중…
      </div>
    );
  }

  if (submitted && isPaid) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-sky-600 text-white shadow-md">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-9 w-9"
                aria-hidden
              >
                <path
                  fillRule="evenodd"
                  d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <h1 className="mt-5 text-2xl font-extrabold text-gray-900">
              구매가 완료되었습니다.
              <br />
              감사합니다!
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              카운터에서 결제가 정상 처리되었습니다.
            </p>
          </div>

          <div className="mt-8 border-t border-gray-100 pt-5">
            <p className="text-xs font-semibold tracking-wide text-gray-400">
              구매 내역
            </p>
            {receiptItems.length === 0 ? (
              <p className="mt-3 text-sm text-gray-400">내역 없음</p>
            ) : (
              <ul className="mt-3 divide-y divide-gray-100">
                {receiptItems.map((item) => (
                  <li
                    key={item.productId}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs text-gray-400">
                        {item.brand}
                      </p>
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {item.name}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums text-sky-700">
                      × {item.qty}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <p className="text-xs font-semibold tracking-wide text-sky-600">
            SpaceShop Smart Order
          </p>
          <h1 className="mt-3 text-2xl font-extrabold text-gray-900">
            결제 대기 중
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-500">
            주문서가 포스기로 전송되었습니다.
            <br />
            카운터로 와 주세요.
          </p>
          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
            결제 완료 시 자동으로 화면이 전환됩니다
          </div>
          {receiptItems.length > 0 && (
            <ul className="mt-6 space-y-2 border-t border-gray-100 pt-4 text-left">
              {receiptItems.map((item) => (
                <li
                  key={item.productId}
                  className="flex justify-between gap-2 text-sm text-gray-600"
                >
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 font-semibold">× {item.qty}</span>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            disabled={retracting}
            onClick={() => void handleEditOrder()}
            className="mt-8 w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-600 transition hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 disabled:opacity-50"
          >
            {retracting ? "취소 중…" : "주문 내용 수정하기"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen w-full flex-col bg-gray-50 pb-8">
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white px-3 pb-2.5 pt-3 sm:px-4">
        <div className="text-center">
          <h1 className="text-lg font-extrabold leading-tight tracking-tight text-gray-900 whitespace-pre-line sm:text-xl">
            {"스페이스 샵 4주년\n스마트 오더"}
          </h1>
          <p className="mt-1.5 text-xs text-gray-500">
            원하는 제품을 담고 주문서를 제출해 주세요.
          </p>
        </div>

        <div className="relative mx-auto mt-3 max-w-xl">
          <span
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400"
            aria-hidden
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-3.5 w-3.5"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="제품명 또는 브랜드명 검색"
            className="w-full rounded-full border border-gray-200 bg-white py-1.5 pr-9 pl-9 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-900"
          />
        </div>

        <div className="mt-2.5 space-y-2">
          <div className={SCROLL_ROW}>
            {COMPANY_PILLS.map((pill) => (
              <PillButton
                key={pill.value}
                label={pill.label}
                active={companyFilter === pill.value}
                onClick={() => setCompanyFilter(pill.value)}
              />
            ))}
          </div>
          <div className={SCROLL_ROW}>
            {LIQUOR_PILLS.map((pill) => (
              <PillButton
                key={pill.value}
                label={pill.label}
                active={liquorFilter === pill.value}
                onClick={() => setLiquorFilter(pill.value)}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setBrandSearchOpen((prev) => !prev)}
            className={[
              "flex w-full items-center justify-center gap-1 rounded-xl py-2.5 text-sm font-medium transition",
              brandSearchOpen || initialFilter !== "전체" || brandFilter
                ? "bg-gray-900 text-white"
                : "bg-gray-50 text-gray-500 hover:bg-gray-100",
            ].join(" ")}
          >
            브랜드 상세 검색 {brandSearchOpen ? "▴" : "▾"}
          </button>
          {brandSearchOpen && (
            <div className="space-y-2 border-t border-gray-100 pt-2">
              <div className={SCROLL_ROW}>
                {INITIAL_PILLS.map((pill) => (
                  <PillButton
                    key={pill.value}
                    label={pill.label}
                    active={initialFilter === pill.value}
                    onClick={() => {
                      setInitialFilter(pill.value);
                      setBrandFilter(null);
                    }}
                    size="tiny"
                  />
                ))}
              </div>
              {initialFilter !== "전체" && brandsForInitial.length > 0 && (
                <div className={SCROLL_ROW}>
                  {brandsForInitial.map((brand) => (
                    <PillButton
                      key={brand}
                      label={brand}
                      active={brandFilter === brand}
                      onClick={() =>
                        setBrandFilter((prev) =>
                          prev === brand ? null : brand
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-4 sm:px-4">
        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="mb-4 break-inside-avoid"
                style={{ height: `${140 + (index % 3) * 48}px` }}
              >
                <div className="h-full animate-pulse rounded-xl border border-gray-200 bg-white shadow-sm" />
              </div>
            ))}
          </div>
        ) : companyGroups.length === 0 ? (
          <p className="py-16 text-center text-sm text-gray-500">
            표시할 제품이 없습니다
          </p>
        ) : (
          <div className="space-y-8">
            {companyGroups.map((company) => (
              <section key={company.companyType}>
                <div className="mb-4 flex items-end justify-between gap-3">
                  <h2 className="truncate text-lg font-extrabold text-gray-900 sm:text-xl">
                    {company.label}
                  </h2>
                  <p className="shrink-0 text-xs text-gray-500">
                    총 {company.totalCount}개 품목 (품절 {company.soldOutCount}
                    개)
                  </p>
                </div>

                <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
                  {company.brands.map((brandGroup) => (
                    <article
                      key={`${company.companyType}-${brandGroup.brand}`}
                      className="mb-4 break-inside-avoid overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
                    >
                      <div className="flex items-baseline justify-between gap-2 border-b border-gray-100 px-3.5 py-3">
                        <h3 className="min-w-0 truncate text-base font-bold text-gray-900">
                          {brandGroup.brand}
                        </h3>
                        <span className="shrink-0 text-sm font-semibold text-sky-600">
                          {brandGroup.totalCount}개
                        </span>
                      </div>

                      <ul className="divide-y divide-gray-100 px-2 py-1">
                        {brandGroup.products.map((row) => {
                          const soldOut = row.storageQty === 0;
                          const inCart =
                            cart.find((c) => c.productId === row.id)?.qty ?? 0;
                          const lowStock =
                            row.storageQty > 0 && row.storageQty <= 2;

                          return (
                            <li
                              key={row.id}
                              className="flex flex-col gap-2 px-1.5 py-3"
                            >
                              <div className="flex items-start gap-2">
                                <p
                                  className={[
                                    "min-w-0 flex-1 text-sm leading-snug",
                                    soldOut
                                      ? "text-gray-400 line-through"
                                      : "font-medium text-gray-800",
                                  ].join(" ")}
                                >
                                  {row.name}
                                </p>
                                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                  {soldOut && (
                                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                                      품절
                                    </span>
                                  )}
                                  {lowStock && (
                                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-700">
                                      품절 임박
                                    </span>
                                  )}
                                  {row.liquorType ? (
                                    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">
                                      {row.liquorType}
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <div className="flex items-center justify-between gap-2">
                                <p
                                  className={[
                                    "text-sm font-bold tabular-nums",
                                    soldOut ? "text-gray-400" : "text-sky-700",
                                  ].join(" ")}
                                >
                                  {formatPrice(row.price)}
                                </p>
                                <div className="flex items-center gap-2">
                                  {inCart > 0 && (
                                    <span className="text-xs font-medium text-sky-600">
                                      담김 {inCart}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    disabled={
                                      soldOut ||
                                      addingId === row.id ||
                                      submitting
                                    }
                                    onClick={() => void handleAddToCart(row)}
                                    className="rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
                                  >
                                    {soldOut
                                      ? "품절"
                                      : addingId === row.id
                                        ? "확인 중…"
                                        : "담기"}
                                  </button>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      <button
        type="button"
        onClick={() => setIsCartOpen(true)}
        className="fixed right-5 bottom-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-sky-600 text-white shadow-lg shadow-sky-900/25 transition hover:bg-sky-500 active:scale-95"
        aria-label="장바구니 열기"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-6 w-6"
          aria-hidden
        >
          <path d="M2.25 2.25a.75.75 0 0 0 0 1.5h1.386c.17 0 .318.114.362.278l2.558 9.592a2.25 2.25 0 0 0 2.172 1.68h8.887a.75.75 0 0 0 0-1.5H8.728a.75.75 0 0 1-.724-.56l-.24-.9h9.51a2.25 2.25 0 0 0 2.205-1.755l1.32-5.94a.75.75 0 0 0-.727-.91H6.112L5.38 2.722A1.875 1.875 0 0 0 3.636 1.5H2.25Z" />
          <path d="M8.25 19.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0ZM18.75 19.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
        </svg>
        {cartItemCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white shadow">
            {cartItemCount > 99 ? "99+" : cartItemCount}
          </span>
        )}
      </button>

      {/* Overlay */}
      <button
        type="button"
        aria-label="장바구니 닫기"
        onClick={() => setIsCartOpen(false)}
        className={[
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-300",
          isCartOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        ].join(" ")}
      />

      {/* Side Drawer */}
      <aside
        className={[
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-md transform flex-col bg-white shadow-2xl transition-transform duration-300 ease-out",
          isCartOpen ? "translate-x-0" : "translate-x-full",
        ].join(" ")}
        aria-hidden={!isCartOpen}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3.5">
          <div>
            <h2 className="text-base font-bold text-gray-900">장바구니</h2>
            <p className="text-xs text-gray-400">
              {cart.length === 0
                ? "담긴 제품이 없습니다"
                : `${cart.length}종류 · 총 ${cartItemCount}개`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsCartOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            aria-label="닫기"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-5 w-5"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {cart.length === 0 ? (
            <div className="flex h-full min-h-[12rem] flex-col items-center justify-center text-sm text-gray-400">
              <p>제품을 담아 주세요</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {cart.map((item) => {
                const unitPrice =
                  typeof item.price === "number" && Number.isFinite(item.price)
                    ? item.price
                    : products.find((p) => p.id === item.productId)?.price ?? 0;

                return (
                  <li
                    key={item.productId}
                    className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-gray-400">
                          {item.brand}
                        </p>
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {item.name}
                        </p>
                        <p className="mt-0.5 text-xs font-medium tabular-nums text-sky-700">
                          {formatPrice(unitPrice)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.productId)}
                        className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        삭제
                      </button>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1 rounded-lg bg-white p-0.5 shadow-sm">
                        <button
                          type="button"
                          onClick={() =>
                            void changeCartQty(item.productId, -1)
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-md text-lg font-bold text-gray-700 hover:bg-gray-100"
                          aria-label="수량 감소"
                        >
                          −
                        </button>
                        <span className="min-w-[2rem] text-center text-base font-bold tabular-nums text-gray-900">
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void changeCartQty(item.productId, 1)
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-md text-lg font-bold text-gray-700 hover:bg-gray-100"
                          aria-label="수량 증가"
                        >
                          +
                        </button>
                      </div>
                      <p className="text-sm font-bold tabular-nums text-gray-900">
                        {formatPrice(unitPrice * item.qty)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-200 bg-white px-4 py-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
          <div className="mb-3 flex items-end justify-between gap-2">
            <span className="text-sm font-medium text-gray-600">
              총 결제 예상 금액
            </span>
            <span className="text-xl font-extrabold tabular-nums text-sky-700">
              {formatPrice(cartTotalPrice)}
            </span>
          </div>
          <button
            type="button"
            disabled={cart.length === 0 || submitting}
            onClick={() => void handleSubmitOrder()}
            className="flex w-full items-center justify-center rounded-2xl bg-sky-600 px-4 py-3.5 text-base font-bold text-white shadow-md transition hover:bg-sky-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-300 disabled:shadow-none"
          >
            {submitting ? "제출 중…" : "주문서 제출하기"}
          </button>
        </div>
      </aside>
    </main>
  );
}
