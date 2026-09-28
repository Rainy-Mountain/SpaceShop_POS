"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchInventoryDashboardData } from "@/lib/fetchInventory";
import { getBrandInitialKey, KOREAN_INITIALS } from "@/lib/koreanInitial";
import {
  hasPaidOrderForQueue,
  loadActiveOrderForQueue,
  revertOrderToShopping,
  syncShoppingCart,
  type CartItem,
} from "@/lib/orderActions";
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

function cartStorageKey(queueId: string): string {
  return `spaceshop:order-cart:${queueId}`;
}

function readCartFromStorage(queueId: string): CartItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cartStorageKey(queueId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const items: CartItem[] = parsed
      .map((row) => {
        const item = row as Partial<CartItem>;
        const productId = String(item.productId ?? "").trim();
        const qty = Number(item.qty) || 0;
        if (!productId || qty <= 0) return null;
        return {
          productId,
          name: String(item.name ?? "제품"),
          brand: String(item.brand ?? ""),
          qty,
          price:
            typeof item.price === "number" && Number.isFinite(item.price)
              ? item.price
              : undefined,
        };
      })
      .filter((item): item is CartItem => item != null);
    return items;
  } catch {
    return null;
  }
}

function writeCartToStorage(queueId: string, items: CartItem[]): void {
  if (typeof window === "undefined") return;
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(cartStorageKey(queueId));
      return;
    }
    window.localStorage.setItem(cartStorageKey(queueId), JSON.stringify(items));
  } catch (err) {
    console.warn("[CustomerOrderBoard] localStorage 저장 실패", err);
  }
}

function clearCartStorage(queueId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(cartStorageKey(queueId));
  } catch {
    /* ignore */
  }
}

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
  const [cart, setCart] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [submittedOrderId, setSubmittedOrderId] = useState<string | null>(null);
  const [receiptItems, setReceiptItems] = useState<CartItem[]>([]);
  const [isPaid, setIsPaid] = useState(false);
  const [retracting, setRetracting] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [syncingCart, setSyncingCart] = useState(false);
  const [cartSyncError, setCartSyncError] = useState<string | null>(null);
  const [queueNumber, setQueueNumber] = useState<number | null>(null);
  const [customerName, setCustomerName] = useState<string>("");
  /** waiting = 미리보기, entered/ordering = 쇼핑 가능 */
  const [queueStatus, setQueueStatus] = useState<string | null>(null);
  /** 장바구니에 담긴 채 storage_qty가 0이 된 제품 (실시간 품절 노티) */
  const [justSoldOutIds, setJustSoldOutIds] = useState<Set<string>>(
    () => new Set()
  );

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
    const activeQueueId = queueId;

    let disposed = false;

    async function loadQueueProfile() {
      const { data, error } = await supabase
        .from("queues")
        .select("queue_number, customer_name, status")
        .eq("id", activeQueueId)
        .maybeSingle();
      if (error) {
        console.error("[CustomerOrderBoard] queue 정보 조회 실패", error);
        return;
      }
      if (disposed || !data) return;
      setQueueNumber(Number(data.queue_number) || null);
      setCustomerName(String(data.customer_name ?? "").trim());
      setQueueStatus(String(data.status ?? "waiting"));
    }

    void loadQueueProfile();

    const channel = supabase
      .channel(
        `queue-entry:${activeQueueId}:${
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : Date.now()
        }`
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "sck",
          table: "queues",
          filter: `id=eq.${activeQueueId}`,
        },
        (payload) => {
          const next = (payload.new ?? {}) as {
            status?: string;
            queue_number?: number;
            customer_name?: string;
          };
          if (next.status) setQueueStatus(String(next.status));
          if (next.queue_number != null) {
            setQueueNumber(Number(next.queue_number) || null);
          }
          if (next.customer_name != null) {
            setCustomerName(String(next.customer_name).trim());
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "sck", table: "queues" },
        (payload) => {
          const next = (payload.new ?? {}) as {
            id?: string;
            status?: string;
            queue_number?: number;
            customer_name?: string;
          };
          if (String(next.id ?? "") !== activeQueueId) return;
          if (next.status) setQueueStatus(String(next.status));
          if (next.queue_number != null) {
            setQueueNumber(Number(next.queue_number) || null);
          }
          if (next.customer_name != null) {
            setCustomerName(String(next.customer_name).trim());
          }
        }
      )
      .subscribe();

    const poll = window.setInterval(() => {
      void loadQueueProfile();
    }, 4000);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [queueId]);

  const isPreviewMode =
    !submitted && (queueStatus === null || queueStatus === "waiting");
  const canShop =
    !submitted &&
    (queueStatus === "entered" || queueStatus === "ordering");

  useEffect(() => {
    if (typeof window === "undefined" || !queueId) return;
    const activeQueueId = queueId;

    let cancelled = false;

    function hydrateItems(
      items: CartItem[],
      rows: DashboardRow[]
    ): CartItem[] {
      return items.map((item) => {
        const row = rows.find((p) => p.id === item.productId);
        return {
          ...item,
          brand: row?.brand || item.brand || "",
          name: row?.name || item.name,
          price: row?.price ?? item.price,
        };
      });
    }

    async function load() {
      setLoading(true);
      setError(null);

      // 1) localStorage 즉시 복구 (체감 개선 — 이후 DB가 있으면 덮어씀)
      const cached = readCartFromStorage(activeQueueId);
      if (cached && cached.length > 0) {
        setCart(cached);
      }

      try {
        const [data, activeOrder, paid] = await Promise.all([
          fetchInventoryDashboardData(undefined, { orderBy: "created" }),
          loadActiveOrderForQueue(activeQueueId),
          hasPaidOrderForQueue(activeQueueId),
        ]);
        if (cancelled) return;
        setProducts(data.rows);

        // 결제 완료된 대기열이면 완료 화면만 표시
        if (paid && !activeOrder) {
          setSubmitted(true);
          setIsPaid(true);
          setCart([]);
          clearCartStorage(activeQueueId);
          return;
        }

        if (activeOrder) {
          setSubmittedOrderId(activeOrder.orderId);

          // 2) DB(shopping/pending) 품목이 최종 소스 — 화면 껐다 켜도 복구
          if (activeOrder.items.length > 0) {
            const hydrated = hydrateItems(activeOrder.items, data.rows);
            setCart(hydrated);
            setReceiptItems(hydrated);
            writeCartToStorage(activeQueueId, hydrated);
          } else if (cached && cached.length > 0) {
            const hydratedCache = hydrateItems(cached, data.rows);
            setCart(hydratedCache);
            writeCartToStorage(activeQueueId, hydratedCache);
            if (activeOrder.status === "shopping") {
              void syncShoppingCart(activeQueueId, hydratedCache)
                .then(({ orderId }) => {
                  if (orderId) setSubmittedOrderId(orderId);
                })
                .catch(console.error);
            }
          } else {
            setCart([]);
            clearCartStorage(activeQueueId);
          }

          if (activeOrder.status === "pending") {
            setSubmitted(true);
            setReceiptItems((prev) => {
              if (prev.length > 0) return prev;
              if (activeOrder.items.length > 0) {
                return hydrateItems(activeOrder.items, data.rows);
              }
              return cached ?? [];
            });
          } else if (activeOrder.status === "shopping") {
            setSubmitted(false);
            setIsPaid(false);
          }
        } else if (cached && cached.length > 0) {
          // 3) DB 주문 없고 캐시만 있으면 shopping으로 재동기화
          const hydratedCache = hydrateItems(cached, data.rows);
          setCart(hydratedCache);
          void syncShoppingCart(activeQueueId, hydratedCache)
            .then(({ orderId }) => {
              if (orderId) setSubmittedOrderId(orderId);
            })
            .catch(console.error);
        } else {
          setCart([]);
          clearCartStorage(activeQueueId);
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "제품 목록을 불러오지 못했습니다.";
        console.error(err);
        if (!cancelled) setError(message);
        // DB 실패해도 localStorage 캐시는 유지
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
        { event: "*", schema: "sck", table: "inventory" },
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
              void fetchInventoryDashboardData(undefined, {
                orderBy: "created",
              })
                .then((data) => setProducts(data.rows))
                .catch(console.error);
            }, 120);
            return;
          }
          const storageQty = toNumber(next.storage_qty);
          const backupQty = toNumber(next.backup_qty);

          // 장바구니에 있는 제품이 방금 품절(0)되면 노티 대상에 추가
          if (storageQty === 0) {
            setCart((currentCart) => {
              if (currentCart.some((item) => item.productId === productId)) {
                setJustSoldOutIds((prev) => {
                  if (prev.has(productId)) return prev;
                  const nextSet = new Set(prev);
                  nextSet.add(productId);
                  return nextSet;
                });
              }
              return currentCart;
            });
          } else {
            setJustSoldOutIds((prev) => {
              if (!prev.has(productId)) return prev;
              const nextSet = new Set(prev);
              nextSet.delete(productId);
              return nextSet;
            });
          }

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

  const cartSoldOutIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of cart) {
      const row = products.find((p) => p.id === item.productId);
      const storage = row?.storageQty;
      if (storage === 0 || justSoldOutIds.has(item.productId)) {
        ids.add(item.productId);
      }
    }
    return ids;
  }, [cart, products, justSoldOutIds]);

  const hasSoldOutInCart = cartSoldOutIds.size > 0;

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

  async function persistCart(nextCart: CartItem[]) {
    if (!queueId || submitted || !canShop) return;
    writeCartToStorage(queueId, nextCart);
    setSyncingCart(true);
    setCartSyncError(null);
    try {
      const { orderId } = await syncShoppingCart(queueId, nextCart);
      if (orderId) setSubmittedOrderId(orderId);
      else if (nextCart.length === 0) setSubmittedOrderId(null);
    } catch (err) {
      console.error("[CustomerOrderBoard] cart sync 실패", err);
      const message =
        err instanceof Error ? err.message : "장바구니 동기화에 실패했습니다.";
      setCartSyncError(message);
    } finally {
      setSyncingCart(false);
    }
  }

  async function handleAddToCart(row: DashboardRow) {
    if (!canShop || submitted || row.storageQty === 0) return;

    setAddingId(row.id);
    try {
      const cartQty = cart.find((item) => item.productId === row.id)?.qty ?? 0;
      // 대기 물량 체크 없이 storage > 0이면 담기 허용 (본인 수량만 storage 이하로 제한)
      if (cartQty >= row.storageQty) {
        window.alert("담을 수 있는 최대 수량입니다.");
        return;
      }

      const nextCart = (() => {
        const existing = cart.find((item) => item.productId === row.id);
        if (existing) {
          return cart.map((item) =>
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
          ...cart,
          {
            productId: row.id,
            name: row.name,
            brand: row.brand,
            qty: 1,
            price: row.price,
          },
        ];
      })();

      setCart(nextCart);
      await persistCart(nextCart);
    } finally {
      setAddingId(null);
    }
  }

  async function changeCartQty(productId: string, delta: number) {
    if (!canShop || submitted) return;

    const item = cart.find((row) => row.productId === productId);
    if (!item) return;

    const nextQty = item.qty + delta;
    if (nextQty <= 0) {
      const nextCart = cart.filter((row) => row.productId !== productId);
      setCart(nextCart);
      setJustSoldOutIds((prev) => {
        if (!prev.has(productId)) return prev;
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
      await persistCart(nextCart);
      return;
    }

    if (delta > 0) {
      const product = products.find((p) => p.id === productId);
      const storageQty = product?.storageQty ?? 0;
      if (storageQty <= 0) {
        window.alert("품절된 제품입니다.");
        return;
      }
      if (nextQty > storageQty) {
        window.alert("담을 수 있는 최대 수량입니다.");
        return;
      }
    }

    const nextCart = cart.map((row) =>
      row.productId === productId ? { ...row, qty: nextQty } : row
    );
    setCart(nextCart);
    await persistCart(nextCart);
  }

  async function removeFromCart(productId: string) {
    if (!canShop || submitted) return;
    const nextCart = cart.filter((row) => row.productId !== productId);
    setCart(nextCart);
    setJustSoldOutIds((prev) => {
      if (!prev.has(productId)) return prev;
      const next = new Set(prev);
      next.delete(productId);
      return next;
    });
    await persistCart(nextCart);
  }

  async function handleEditOrder() {
    if (!queueId || retracting || isPaid || !submittedOrderId) return;

    const ok = window.confirm(
      "포스기 전송을 취소하고 장바구니를 다시 수정할까요?"
    );
    if (!ok) return;

    setRetracting(true);
    try {
      await revertOrderToShopping(submittedOrderId);
      setCart((prev) => (prev.length > 0 ? prev : receiptItems));
      setSubmitted(false);
      setIsPaid(false);
    } catch (err) {
      console.error("[CustomerOrderBoard] 주문 수정 실패", err);
      const message =
        err instanceof Error ? err.message : "주문 수정에 실패했습니다.";
      window.alert(`주문 수정 실패: ${message}`);
    } finally {
      setRetracting(false);
    }
  }

  // 본인 주문 status 실시간 — shopping→pending(포스 전송), pending→paid(결제 완료)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!queueId || isPaid) return;
    const activeQueueId = queueId;

    let disposed = false;
    let pollTimer: number | null = null;

    function applyStatus(status?: string | null, orderId?: string | null) {
      if (disposed || !status) return;
      if (orderId) setSubmittedOrderId(orderId);
      if (status === "pending") {
        setReceiptItems((prev) => (prev.length > 0 ? prev : cart));
        setSubmitted(true);
        setIsCartOpen(false);
      }
      if (status === "paid") {
        setSubmitted(true);
        setIsPaid(true);
        clearCartStorage(activeQueueId);
      }
      if (status === "shopping") {
        setSubmitted(false);
        setIsPaid(false);
      }
    }

    async function checkOnce() {
      try {
        const active = await loadActiveOrderForQueue(activeQueueId);
        if (!active) return;
        applyStatus(active.status, active.orderId);
      } catch (err) {
        console.error("[CustomerOrderBoard] status 폴링 실패", err);
      }
    }

    const channel = supabase
      .channel(
        `order-status:${activeQueueId}:${
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : Date.now()
        }`
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "sck",
          table: "orders",
          filter: `queue_id=eq.${activeQueueId}`,
        },
        (payload) => {
          const next = (payload.new ?? {}) as {
            id?: string;
            status?: string;
          };
          console.info("[CustomerOrderBoard] orders UPDATE", next);
          applyStatus(next.status, next.id ? String(next.id) : null);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "sck",
          table: "orders",
        },
        (payload) => {
          const next = (payload.new ?? {}) as {
            id?: string;
            queue_id?: string;
            status?: string;
          };
          if (String(next.queue_id ?? "") !== activeQueueId) return;
          applyStatus(next.status, next.id ? String(next.id) : null);
        }
      )
      .subscribe();

    void checkOnce();
    pollTimer = window.setInterval(() => {
      void checkOnce();
    }, 3000);

    return () => {
      disposed = true;
      if (pollTimer != null) window.clearInterval(pollTimer);
      void supabase.removeChannel(channel);
    };
    // cart는 applyStatus 스냅샷용 — 의도적으로 deps 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueId, isPaid]);

  if (!queueId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        이동 중…
      </div>
    );
  }

  if (submitted && isPaid) {
    return (
      <main className="flex h-[100dvh] min-h-screen w-full flex-col items-center justify-center bg-white px-6">
        <div className="flex flex-col items-center text-center">
          <span
            className="flex h-24 w-24 items-center justify-center rounded-full bg-sky-500 text-white"
            aria-hidden
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-14 w-14"
            >
              <path
                fillRule="evenodd"
                d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <h1 className="mt-8 text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
            구매가 완료되었습니다!
          </h1>
          <p className="mt-3 text-base text-gray-500">
            이용해 주셔서 감사합니다.
          </p>
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
            포스기(결제 카운터)로
            <br />
            이동해 주세요.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-500">
            직원이 주문서를 포스기로 전달했습니다.
            <br />
            카운터에서 결제를 진행해 주세요.
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
    <main
      className={[
        "relative flex min-h-screen w-full flex-col bg-gray-50",
        isPreviewMode ? "pb-16" : "pb-8",
      ].join(" ")}
    >
      <header
        className={[
          "sticky top-0 z-20 border-b border-gray-200 bg-white",
          isPreviewMode
            ? "px-2 pb-2 pt-2.5 sm:px-3"
            : "px-3 pb-2.5 pt-3 sm:px-4",
        ].join(" ")}
      >
        <div className="text-center">
          <h1
            className={[
              "font-extrabold leading-tight tracking-tight text-gray-900 whitespace-pre-line",
              isPreviewMode ? "text-base sm:text-lg" : "text-lg sm:text-xl",
            ].join(" ")}
          >
            {"스페이스 샵 4주년\n스마트 오더"}
          </h1>
          {!isPreviewMode && (
            <p className="mt-1.5 text-xs text-gray-500">
              원하는 제품을 담고 직원에게 화면을 보여주세요.
            </p>
          )}
        </div>

        <div
          className={[
            "relative mx-auto max-w-xl",
            isPreviewMode ? "mt-2" : "mt-3",
          ].join(" ")}
        >
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
            className="w-full rounded-full border border-gray-200 bg-white py-2 pr-9 pl-9 text-base text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-900"
          />
        </div>

        <div className={isPreviewMode ? "mt-2 space-y-1.5" : "mt-2.5 space-y-2"}>
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
              "flex w-full items-center justify-center gap-1 rounded-xl text-sm font-medium transition",
              isPreviewMode ? "py-2" : "py-2.5",
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

      <div
        className={[
          "min-h-0 flex-1 overflow-y-auto",
          isPreviewMode ? "px-1.5 py-2 sm:px-3" : "px-2 py-4 sm:px-4",
        ].join(" ")}
      >
        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div
            className={[
              "columns-1 md:columns-2 xl:columns-3",
              isPreviewMode ? "gap-2" : "gap-4",
            ].join(" ")}
          >
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className={
                  isPreviewMode
                    ? "mb-2 break-inside-avoid"
                    : "mb-4 break-inside-avoid"
                }
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
          <div className={isPreviewMode ? "space-y-4" : "space-y-8"}>
            {companyGroups.map((company) => (
              <section key={company.companyType}>
                <div
                  className={[
                    "flex items-end justify-between gap-3",
                    isPreviewMode ? "mb-2 px-0.5" : "mb-4",
                  ].join(" ")}
                >
                  <h2
                    className={[
                      "truncate font-extrabold text-gray-900",
                      isPreviewMode
                        ? "text-base sm:text-lg"
                        : "text-lg sm:text-xl",
                    ].join(" ")}
                  >
                    {company.label}
                  </h2>
                  <p className="shrink-0 text-xs text-gray-500">
                    총 {company.totalCount}개 품목 (품절 {company.soldOutCount}
                    개)
                  </p>
                </div>

                <div
                  className={[
                    "columns-1 md:columns-2 xl:columns-3",
                    isPreviewMode ? "gap-2" : "gap-4",
                  ].join(" ")}
                >
                  {company.brands.map((brandGroup) => (
                    <article
                      key={`${company.companyType}-${brandGroup.brand}`}
                      className={[
                        "break-inside-avoid overflow-hidden border border-gray-200 bg-white shadow-sm",
                        isPreviewMode
                          ? "mb-2 rounded-lg"
                          : "mb-4 rounded-xl",
                      ].join(" ")}
                    >
                      <div
                        className={[
                          "flex items-baseline justify-between gap-2 border-b border-gray-100",
                          isPreviewMode ? "px-3 py-2" : "px-3.5 py-3",
                        ].join(" ")}
                      >
                        <h3
                          className={[
                            "min-w-0 truncate font-bold text-gray-900",
                            isPreviewMode ? "text-sm" : "text-base",
                          ].join(" ")}
                        >
                          {brandGroup.brand}
                        </h3>
                        <span
                          className={[
                            "shrink-0 font-semibold text-sky-600",
                            isPreviewMode ? "text-xs" : "text-sm",
                          ].join(" ")}
                        >
                          {brandGroup.totalCount}개
                        </span>
                      </div>

                      <ul
                        className={[
                          "divide-y divide-gray-100",
                          isPreviewMode ? "px-1.5 py-0.5" : "px-2 py-1",
                        ].join(" ")}
                      >
                        {brandGroup.products.map((row) => {
                          const soldOut = row.storageQty === 0;
                          const inCart =
                            cart.find((c) => c.productId === row.id)?.qty ?? 0;
                          const lowStock =
                            row.storageQty > 0 && row.storageQty <= 2;

                          return (
                            <li
                              key={row.id}
                              className={[
                                "flex flex-col",
                                isPreviewMode
                                  ? "gap-1 px-1.5 py-2.5"
                                  : "gap-2 px-1.5 py-3",
                              ].join(" ")}
                            >
                              <div className="flex items-start gap-2">
                                <p
                                  className={[
                                    "min-w-0 flex-1 leading-snug",
                                    isPreviewMode
                                      ? "text-[15px] font-semibold"
                                      : "text-sm",
                                    soldOut
                                      ? "text-gray-400 line-through"
                                      : isPreviewMode
                                        ? "text-gray-900"
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
                                    "font-bold tabular-nums",
                                    isPreviewMode ? "text-base" : "text-sm",
                                    soldOut ? "text-gray-400" : "text-sky-700",
                                  ].join(" ")}
                                >
                                  {formatPrice(row.price)}
                                </p>
                                {canShop && (
                                  <div className="flex items-center gap-2">
                                    {inCart > 0 && (
                                      <span className="text-xs font-medium text-sky-600">
                                        담김 {inCart}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      disabled={
                                        soldOut || addingId === row.id
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
                                )}
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

      {/* 입장 대기 — 하단 플로팅 필 (시야 최소 가림) */}
      {isPreviewMode && (
        <div
          role="status"
          className="pointer-events-none fixed bottom-6 left-1/2 z-50 w-[min(92vw,22rem)] -translate-x-1/2 rounded-full bg-black/80 px-4 py-2.5 text-center shadow-lg"
        >
          <p className="text-sm font-medium leading-snug text-white">
            현재 입장 대기 중 · 직원 안내 후 장바구니 사용 가능
          </p>
        </div>
      )}

      {/* FAB — 입장 승인 후에만 표시 */}
      {canShop && (
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
      )}

      {/* Overlay + Drawer — 입장 승인 후에만 */}
      {canShop && (
        <>
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
        <div className="border-b border-sky-200 bg-sky-600 px-4 py-4 text-white">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-sky-100">
                스마트 오더 · 손님 확인
              </p>
              <p className="mt-1 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
                대기번호:{" "}
                <span className="tabular-nums">
                  {queueNumber != null ? `${queueNumber}번` : "—"}
                </span>
              </p>
              <p className="mt-1 truncate text-lg font-bold text-sky-50 sm:text-xl">
                뒷자리: {customerName || "----"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCartOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sky-100 transition hover:bg-sky-500 hover:text-white"
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
          <p className="mt-2 text-xs text-sky-100">
            {cart.length === 0
              ? "담긴 제품이 없습니다"
              : `${cart.length}종류 · 총 ${cartItemCount}개`}
          </p>
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
                const isSoldOut = cartSoldOutIds.has(item.productId);

                return (
                  <li
                    key={item.productId}
                    className={[
                      "rounded-xl border px-3 py-3",
                      isSoldOut
                        ? "border-red-200 bg-red-50"
                        : "border-gray-100 bg-gray-50",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-gray-400">
                          {item.brand}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p
                            className={[
                              "truncate text-sm font-semibold",
                              isSoldOut
                                ? "text-red-800 line-through"
                                : "text-gray-900",
                            ].join(" ")}
                          >
                            {item.name}
                          </p>
                          {isSoldOut && (
                            <span className="inline-flex shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                              🚨 방금 품절됨
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs font-medium tabular-nums text-sky-700">
                          {formatPrice(unitPrice)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeFromCart(item.productId)}
                        className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                      >
                        삭제
                      </button>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1 rounded-lg bg-white p-0.5 shadow-sm">
                        <button
                          type="button"
                          disabled={isSoldOut}
                          onClick={() =>
                            void changeCartQty(item.productId, -1)
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-md text-lg font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                          aria-label="수량 감소"
                        >
                          −
                        </button>
                        <span className="min-w-[2rem] text-center text-base font-bold tabular-nums text-gray-900">
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          disabled={isSoldOut}
                          onClick={() =>
                            void changeCartQty(item.productId, 1)
                          }
                          className="flex h-9 w-9 items-center justify-center rounded-md text-lg font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-40"
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
          {cartSyncError && (
            <p className="mb-2 text-xs text-red-600">{cartSyncError}</p>
          )}
          {hasSoldOutInCart ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-center">
              <p className="text-sm leading-relaxed font-bold text-red-700">
                품절된 상품을 장바구니에서 삭제해야 직원 확인이 가능합니다.
              </p>
              <p className="mt-1 text-[11px] text-red-500">
                직원에게 화면을 보여주기 전에 품절 품목을 먼저 삭제해 주세요.
              </p>
            </div>
          ) : (
            <p
              className={[
                "rounded-xl border px-3 py-3 text-center text-sm leading-relaxed font-medium",
                syncingCart
                  ? "border-gray-200 bg-gray-50 text-gray-500"
                  : "border-amber-100 bg-amber-50 text-amber-800",
              ].join(" ")}
            >
              {syncingCart
                ? "장바구니 동기화 중…"
                : "선택을 마치셨다면, 직원에게 화면을 보여주세요."}
            </p>
          )}
        </div>
      </aside>
        </>
      )}
    </main>
  );
}
