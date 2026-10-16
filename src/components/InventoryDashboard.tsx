"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import RecentActivityPanel from "@/components/RecentActivityPanel";
import SaleModal from "@/components/SaleModal";
import StockMoveModal from "@/components/StockMoveModal";
import ToastStack, {
  appendToast,
  useToasts,
  type ToastItem,
} from "@/components/ToastStack";
import {
  fetchDashboardSalesStats,
  fetchInventoryDashboardData,
  type ProductDaySales,
  type SalesTotals,
} from "@/lib/fetchInventory";
import { deleteProduct, updateInventoryField, updateProductPrice } from "@/lib/inventoryActions";
import {
  ALPHA_INITIALS,
  KOREAN_INITIALS,
  NUMBER_INITIAL,
  getInitialKey,
  matchesInitialFilter,
  type InitialFilter,
} from "@/lib/koreanInitial";
import { supabase } from "@/lib/supabase";
import { useEventDay } from "@/hooks/useEventDay";
import {
  type CompanyFilter,
  type DashboardRow,
  type EventDay,
} from "@/types/dashboard";

function toRealtimeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function applySoldQtyMap(
  setRows: Dispatch<SetStateAction<DashboardRow[]>>,
  byProduct: Map<string, ProductDaySales>
) {
  setRows((prev) =>
    (prev ?? []).map((row) => {
      const sales = byProduct.get(row.id) ?? {
        day1: 0,
        day2: 0,
        day3: 0,
        total: 0,
      };
      return {
        ...row,
        soldQty: sales.total,
        soldDay1: sales.day1,
        soldDay2: sales.day2,
        soldDay3: sales.day3,
        initialQty: row.totalQty + sales.total,
      };
    })
  );
}

/** Realtime 전용 자식 — deps는 항상 빈 배열로만 마운트 */
function InventoryRealtimeSync({
  setRows,
  setSalesTotals,
  setToasts,
  rowsRef,
  removeActivityByIdRef,
  eventDayRef,
}: {
  setRows: Dispatch<SetStateAction<DashboardRow[]>>;
  setSalesTotals: Dispatch<SetStateAction<SalesTotals>>;
  setToasts: Dispatch<SetStateAction<ToastItem[]>>;
  rowsRef: MutableRefObject<DashboardRow[]>;
  removeActivityByIdRef: MutableRefObject<(id: string) => void>;
  eventDayRef: MutableRefObject<EventDay>;
}) {
  useEffect(() => {
    console.log("[Realtime] 구독 useEffect 실행");

    let statsRefreshTimer: number | null = null;

    async function refreshSalesStatsQuietly() {
      try {
        const stats = await fetchDashboardSalesStats(eventDayRef.current);
        setSalesTotals(stats.totals);
        applySoldQtyMap(setRows, stats.byProduct);
        console.log("[Realtime] 통계 refetch 완료", stats.totals);
      } catch (err) {
        console.error("[Realtime] 통계 refetch 실패", err);
      }
    }

    function scheduleStatsRefresh() {
      if (statsRefreshTimer != null) {
        window.clearTimeout(statsRefreshTimer);
      }
      // 즉시 가까운 시점에 DB 기준으로 통계 덮어쓰기
      statsRefreshTimer = window.setTimeout(() => {
        void refreshSalesStatsQuietly();
      }, 100);
    }

    const channel = supabase
      .channel("realtime:inventory_and_sales")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "sck", table: "inventory" },
        (payload) => {
          console.log("🔄 재고 실시간 수신:", payload);

          const next = (payload.new ?? {}) as {
            product_id?: string;
            storage_qty?: number | string | null;
            backup_qty?: number | string | null;
          };
          const productId = String(next.product_id ?? "");
          if (!productId) return;

          const storageQty = toRealtimeNumber(next.storage_qty);
          const backupQty = toRealtimeNumber(next.backup_qty);

          setRows((prev) =>
            (prev ?? []).map((row) =>
              row.id === productId
                ? {
                    ...row,
                    storageQty,
                    backupQty,
                    totalQty: storageQty + backupQty,
                    initialQty: storageQty + backupQty + row.soldQty,
                  }
                : row
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "sck", table: "sales_logs" },
        (payload) => {
          console.log("💰 판매 실시간 수신:", payload);

          // 통계는 payload 수동 계산 없이 항상 DB refetch로 덮어씀
          scheduleStatsRefresh();

          if (payload.eventType === "INSERT") {
            const newRow = (payload.new ?? {}) as {
              product_id?: string;
              quantity?: number | string | null;
            };
            const productId = String(newRow.product_id ?? "");
            const qty = toRealtimeNumber(newRow.quantity);
            const productName =
              rowsRef.current.find((row) => row.id === productId)?.name ??
              "상품";

            if (qty > 0) {
              appendToast(
                setToasts,
                `✅ [${productName}] ${qty}개 판매 완료`,
                "success"
              );
            }
            return;
          }

          if (payload.eventType === "DELETE") {
            const oldRow = (payload.old ?? {}) as { id?: string };
            const saleId = String(oldRow.id ?? "");
            if (saleId) {
              removeActivityByIdRef.current(saleId);
            }
            appendToast(setToasts, "🚫 판매가 취소되었습니다", "danger");
            return;
          }

          if (payload.eventType === "UPDATE") {
            // 취소는 이력 삭제 대신 voided_at을 기록하므로 다른 기기의 활동 목록도 제거한다.
            const changed = payload.new as { id?: string; voided_at?: string | null };
            if (changed.voided_at && changed.id) {
              removeActivityByIdRef.current(changed.id);
            }
            return;
          }
        }
      )
      .subscribe((status) => {
        console.log("✅ Realtime Connection Status:", status);
      });

    return () => {
      console.log("[Realtime] cleanup removeChannel");
      if (statsRefreshTimer != null) {
        window.clearTimeout(statsRefreshTimer);
      }
      void supabase.removeChannel(channel);
    };
  }, []);

  return null;
}

const COMPANY_FILTERS: CompanyFilter[] = ["전체", "자사", "타사"];

type QuickFilter = "all" | "soldout" | "noprice";

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatPrice(value: number): string {
  return formatNumber(value);
}

function formatCurrency(value: number): string {
  return `${formatNumber(value)}원`;
}

function StockStatusBadge({ totalQty }: { totalQty: number }) {
  if (totalQty === 0) {
    return (
      <span className="inline-flex shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-bold text-slate-600">
        품절
      </span>
    );
  }

  if (totalQty === 1) {
    return (
      <span className="inline-flex shrink-0 rounded bg-rose-600 px-1 py-0.5 text-[10px] font-bold text-white">
        1개
      </span>
    );
  }

  return null;
}

function EditablePriceCell({
  productId,
  price,
  onUpdated,
  cellClassName = "",
}: {
  productId: string;
  price: number;
  onUpdated: (productId: string, nextPrice: number) => void;
  cellClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(price));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(price));
  }, [price, editing]);

  async function save() {
    const next = Number(String(draft).replace(/,/g, "").trim());

    if (!Number.isFinite(next) || next < 0) {
      alert("가격은 0 이상의 숫자로 입력해 주세요.");
      setDraft(String(price));
      setEditing(false);
      return;
    }

    if (next === price) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await updateProductPrice(productId, next);
      onUpdated(productId, next);
      setEditing(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "가격 수정에 실패했습니다.";
      alert(message);
      setDraft(String(price));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
    if (event.key === "Escape") {
      setDraft(String(price));
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <td
        className={[
          "w-20 whitespace-nowrap px-1 py-1 text-center",
          cellClassName,
        ].join(" ")}
      >
        <input
          autoFocus
          type="number"
          min={0}
          step={1}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={onKeyDown}
          className="w-16 rounded border border-sky-300 px-1 py-0.5 text-center text-xs outline-none focus:ring-2 focus:ring-sky-200"
        />
      </td>
    );
  }

  return (
    <td
      className={[
        "w-20 whitespace-nowrap px-1 py-1 text-center",
        cellClassName,
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex min-h-8 min-w-[2.5rem] items-center justify-center rounded px-1.5 py-1.5 tabular-nums text-xs text-slate-700 transition cursor-pointer hover:bg-sky-50 hover:text-sky-700 hover:underline"
        title="가격 수정"
      >
        {formatPrice(price)}
      </button>
    </td>
  );
}

function EditableQtyCell({
  productId,
  field,
  value,
  label,
  onUpdated,
  cellClassName = "",
}: {
  productId: string;
  field: "storage_qty" | "backup_qty";
  value: number;
  label: string;
  onUpdated: (
    productId: string,
    field: "storage_qty" | "backup_qty",
    nextQty: number
  ) => void;
  cellClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  async function save() {
    const raw = String(draft).replace(/,/g, "").trim();
    const next = Number(raw);

    if (!Number.isInteger(next) || next < 0) {
      alert(`${label} 수량은 0 이상의 정수로 입력해 주세요.`);
      setDraft(String(value));
      setEditing(false);
      return;
    }

    if (next === value) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await updateInventoryField(productId, field, next);
      onUpdated(productId, field, next);
      setEditing(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${label} 수정에 실패했습니다.`;
      alert(message);
      setDraft(String(value));
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void save();
    }
    if (event.key === "Escape") {
      setDraft(String(value));
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <td
        className={[
          "w-16 whitespace-nowrap px-0.5 py-1 text-center",
          cellClassName,
        ].join(" ")}
      >
        <input
          autoFocus
          type="number"
          min={0}
          step={1}
          value={draft}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={onKeyDown}
          className="w-12 rounded border border-sky-300 px-0.5 py-0.5 text-center text-xs outline-none focus:ring-2 focus:ring-sky-200"
        />
      </td>
    );
  }

  return (
    <td
      className={[
        "w-16 whitespace-nowrap px-0.5 py-1 text-center",
        cellClassName,
      ].join(" ")}
    >
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex min-h-8 min-w-[2rem] items-center justify-center rounded px-1 py-1.5 tabular-nums text-xs font-medium text-slate-800 transition cursor-pointer hover:bg-sky-50 hover:text-sky-700 hover:underline"
        title={`${label} 수정`}
      >
        {value}
      </button>
    </td>
  );
}

function SummaryCards({
  shopStock,
  backupStock,
  day1Qty,
  day2Qty,
  day3Qty,
  totalSoldQty,
  revenue,
}: {
  shopStock: number;
  backupStock: number;
  day1Qty: number;
  day2Qty: number;
  day3Qty: number;
  totalSoldQty: number;
  revenue: number;
}) {
  const cards = [
    {
      label: "총 샵 재고",
      value: formatNumber(shopStock),
      unit: "개",
      className: "border-sky-200 bg-sky-50",
      labelClass: "text-sky-700",
      valueClass: "text-sky-950",
    },
    {
      label: "총 백업 재고",
      value: formatNumber(backupStock),
      unit: "개",
      className: "border-slate-200 bg-slate-100",
      labelClass: "text-slate-600",
      valueClass: "text-slate-900",
    },
    {
      label: "1~3일차 총 판매",
      value: formatNumber(totalSoldQty),
      unit: "개",
      className: "border-emerald-200 bg-emerald-50",
      labelClass: "text-emerald-700",
      valueClass: "text-emerald-950",
    },
    {
      label: "누적 매출",
      value: formatCurrency(revenue),
      unit: "",
      className: "border-amber-200 bg-amber-50",
      labelClass: "text-amber-800",
      valueClass: "text-amber-950",
    },
  ];

  return (
    <section className="mb-4 space-y-2">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cards.map((card) => (
          <article
            key={card.label}
            className={`rounded-xl border px-3 py-2.5 shadow-sm ${card.className}`}
          >
            <p className={`text-xs font-medium ${card.labelClass}`}>
              {card.label}
            </p>
            <p
              className={`mt-1 text-lg font-bold tabular-nums tracking-tight sm:text-xl ${card.valueClass}`}
            >
              {card.value}
              {card.unit ? (
                <span className="ml-0.5 text-sm font-semibold opacity-70">
                  {card.unit}
                </span>
              ) : null}
            </p>
          </article>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        일차별 판매 · 1일차 {formatNumber(day1Qty)} · 2일차{" "}
        {formatNumber(day2Qty)} · 3일차 {formatNumber(day3Qty)}
      </p>
    </section>
  );
}

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-7 animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

export default function InventoryDashboard() {
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [salesTotals, setSalesTotals] = useState<SalesTotals>({
    quantity: 0,
    revenue: 0,
    day1Quantity: 0,
    day2Quantity: 0,
    day3Quantity: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>("전체");
  const [initialFilter, setInitialFilter] = useState<InitialFilter>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const { eventDay } = useEventDay();
  const [moveTarget, setMoveTarget] = useState<DashboardRow | null>(null);
  const [saleTarget, setSaleTarget] = useState<DashboardRow | null>(null);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { toasts, setToasts, pushToast, dismissToast } = useToasts();
  const rowsRef = useRef<DashboardRow[]>([]);
  rowsRef.current = rows;
  const eventDayRef = useRef<EventDay>(eventDay);
  eventDayRef.current = eventDay;
  const removeActivityByIdRef = useRef<(id: string) => void>(() => {});

  async function refreshSalesStatsQuietly() {
    try {
      const stats = await fetchDashboardSalesStats(eventDayRef.current);
      setSalesTotals(stats.totals);
      applySoldQtyMap(setRows, stats.byProduct);
    } catch (err) {
      console.error("통계 재조회 실패:", err);
    }
  }

  async function loadRows(options?: { silent?: boolean; day?: EventDay }) {
    const day = options?.day ?? eventDayRef.current;
    if (!options?.silent) setLoading(true);
    setError(null);

    try {
      const data = await fetchInventoryDashboardData(day);
      setRows(data.rows);
      setSalesTotals(data.salesTotals);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "재고 데이터를 불러오지 못했습니다.";
      console.error(err);
      setError(message);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadForDay() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchInventoryDashboardData(eventDay);
        if (!cancelled) {
          setRows(data.rows);
          setSalesTotals(data.salesTotals);
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "재고 데이터를 불러오지 못했습니다.";
        console.error(err);
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadForDay();

    return () => {
      cancelled = true;
    };
  }, [eventDay]);

  const summary = useMemo(() => {
    let shopStock = 0;
    let backupStock = 0;
    for (const row of rows) {
      shopStock += row.storageQty;
      backupStock += row.backupQty;
    }
    return {
      shopStock,
      backupStock,
      soldQty: salesTotals.quantity,
      revenue: salesTotals.revenue,
    };
  }, [rows, salesTotals]);

  /** 실제 브랜드명에 존재하는 초성/알파벳만 노출 */
  const availableInitials = useMemo(() => {
    const present = new Set<string>();
    for (const row of rows) {
      present.add(getInitialKey(row.brand));
    }

    return {
      korean: KOREAN_INITIALS.filter((cho) => present.has(cho)),
      alpha: ALPHA_INITIALS.filter((letter) => present.has(letter)),
      hasNumber: present.has(NUMBER_INITIAL),
    };
  }, [rows]);

  useEffect(() => {
    if (!initialFilter) return;
    const stillExists =
      availableInitials.korean.includes(
        initialFilter as (typeof KOREAN_INITIALS)[number]
      ) ||
      availableInitials.alpha.includes(
        initialFilter as (typeof ALPHA_INITIALS)[number]
      ) ||
      (initialFilter === NUMBER_INITIAL && availableInitials.hasNumber);

    if (!stillExists) setInitialFilter(null);
  }, [availableInitials, initialFilter]);

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return rows.filter((row) => {
      if (companyFilter !== "전체" && row.companyType !== companyFilter) {
        return false;
      }

      if (
        initialFilter &&
        !matchesInitialFilter(row.brand, row.name, initialFilter)
      ) {
        return false;
      }

      if (quickFilter === "soldout" && row.totalQty !== 0) {
        return false;
      }

      if (quickFilter === "noprice" && row.price !== 0) {
        return false;
      }

      if (keyword) {
        const inName = row.name.toLowerCase().includes(keyword);
        const inBrand = row.brand.toLowerCase().includes(keyword);
        if (!inName && !inBrand) return false;
      }

      return true;
    });
  }, [rows, search, companyFilter, initialFilter, quickFilter]);

  async function handleSaleSuccess(result: {
    productName: string;
    quantity: number;
  }) {
    pushToast(
      `✅ [${result.productName}] ${result.quantity}개 판매 완료`,
      "success"
    );
    setActivityRefreshKey((prev) => prev + 1);
    window.setTimeout(() => {
      void refreshSalesStatsQuietly();
    }, 150);
  }

  async function handleDataChanged() {
    setActivityRefreshKey((prev) => prev + 1);
    // 통계만 DB 기준으로 조용히 덮어쓰기
    window.setTimeout(() => {
      void refreshSalesStatsQuietly();
    }, 150);
  }

  function handlePriceUpdated(productId: string, nextPrice: number) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === productId ? { ...row, price: nextPrice } : row
      )
    );
  }

  function handleQtyUpdated(
    productId: string,
    field: "storage_qty" | "backup_qty",
    nextQty: number
  ) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== productId) return row;

        const storageQty =
          field === "storage_qty" ? nextQty : row.storageQty;
        const backupQty = field === "backup_qty" ? nextQty : row.backupQty;

        return {
          ...row,
          storageQty,
          backupQty,
          totalQty: storageQty + backupQty,
          initialQty: storageQty + backupQty + row.soldQty,
        };
      })
    );
  }

  async function handleDelete(row: DashboardRow) {
    const confirmed = window.confirm(
      `"${row.name}" 제품을 정말 삭제하시겠습니까?\n관련 재고·판매 기록도 함께 삭제될 수 있습니다.`
    );
    if (!confirmed) return;

    setDeletingId(row.id);
    try {
      await deleteProduct(row.id);
      setRows((prev) => prev.filter((item) => item.id !== row.id));
      setActivityRefreshKey((prev) => prev + 1);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "제품 삭제에 실패했습니다.";
      alert(message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-4 lg:px-6">
      <InventoryRealtimeSync
        setRows={setRows}
        setSalesTotals={setSalesTotals}
        setToasts={setToasts}
        rowsRef={rowsRef}
        removeActivityByIdRef={removeActivityByIdRef}
        eventDayRef={eventDayRef}
      />
      <div className="mb-3">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          재고 현황판
        </h1>
        <p className="mt-1 text-xs text-slate-500">
          가격·샵·백업 재고 수정 유지 · 우측 1~3일차 판매량 집계
        </p>
      </div>

      <SummaryCards
        shopStock={summary.shopStock}
        backupStock={summary.backupStock}
        day1Qty={salesTotals.day1Quantity}
        day2Qty={salesTotals.day2Quantity}
        day3Qty={salesTotals.day3Quantity}
        totalSoldQty={summary.soldQty}
        revenue={summary.revenue}
      />

      <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_auto_auto] lg:items-end">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              검색
            </span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="제품명 또는 브랜드명"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
            />
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">
              구분
            </span>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
              {COMPANY_FILTERS.map((filter) => {
                const active = companyFilter === filter;
                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setCompanyFilter(filter)}
                    className={[
                      "rounded-md px-3 py-1.5 text-xs font-semibold transition",
                      active
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-slate-500 hover:text-slate-800",
                    ].join(" ")}
                  >
                    {filter}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">
              퀵 필터
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setQuickFilter((prev) =>
                    prev === "soldout" ? "all" : "soldout"
                  )
                }
                className={[
                  "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                  quickFilter === "soldout"
                    ? "bg-rose-600 text-white"
                    : "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
                ].join(" ")}
              >
                품절 제품
              </button>
              <button
                type="button"
                onClick={() =>
                  setQuickFilter((prev) =>
                    prev === "noprice" ? "all" : "noprice"
                  )
                }
                className={[
                  "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                  quickFilter === "noprice"
                    ? "bg-amber-600 text-white"
                    : "border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
                ].join(" ")}
              >
                가격 미기입
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-slate-500">
              초성 · 알파벳
            </span>
            {initialFilter && (
              <button
                type="button"
                onClick={() => setInitialFilter(null)}
                className="text-[11px] font-medium text-sky-600 hover:text-sky-700"
              >
                해제
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setInitialFilter(null)}
              className={[
                "min-w-6 rounded px-1.5 py-0.5 text-[11px] font-semibold transition",
                initialFilter === null
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              ].join(" ")}
            >
              전체
            </button>
            {availableInitials.korean.map((cho) => {
              const active = initialFilter === cho;
              return (
                <button
                  key={cho}
                  type="button"
                  onClick={() =>
                    setInitialFilter((prev) => (prev === cho ? null : cho))
                  }
                  className={[
                    "min-w-6 rounded px-1.5 py-0.5 text-[11px] font-semibold transition",
                    active
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-sky-50 hover:text-sky-700",
                  ].join(" ")}
                >
                  {cho}
                </button>
              );
            })}
            {availableInitials.alpha.length > 0 && (
              <span className="mx-0.5 self-center text-slate-300">|</span>
            )}
            {availableInitials.alpha.map((letter) => {
              const active = initialFilter === letter;
              return (
                <button
                  key={letter}
                  type="button"
                  onClick={() =>
                    setInitialFilter((prev) =>
                      prev === letter ? null : letter
                    )
                  }
                  className={[
                    "min-w-6 rounded px-1.5 py-0.5 text-[11px] font-semibold transition",
                    active
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-sky-50 hover:text-sky-700",
                  ].join(" ")}
                >
                  {letter}
                </button>
              );
            })}
            {availableInitials.hasNumber && (
              <>
                <span className="mx-0.5 self-center text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() =>
                    setInitialFilter((prev) =>
                      prev === NUMBER_INITIAL ? null : NUMBER_INITIAL
                    )
                  }
                  className={[
                    "rounded px-1.5 py-0.5 text-[11px] font-semibold transition",
                    initialFilter === NUMBER_INITIAL
                      ? "bg-sky-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-sky-50 hover:text-sky-700",
                  ].join(" ")}
                >
                  숫자
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800"
        >
          <p className="text-sm font-semibold">데이터 불러오기 실패</p>
          <p className="mt-1 text-xs">{error}</p>
          <button
            type="button"
            onClick={() => void loadRows()}
            className="mt-2 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white"
          >
            다시 시도
          </button>
        </div>
      )}

      {loading ? (
        <TableSkeleton />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[1080px] table-fixed border-collapse text-left text-xs">
            <colgroup>
              <col className="w-[7%]" />
              <col className="w-[22%] min-w-[300px]" />
              <col className="w-[5%]" />
              <col className="w-[7%]" />
              <col className="w-[6%]" />
              <col className="w-[6%]" />
              <col className="w-[3%]" />
              <col className="w-[6%]" />
              <col className="w-[5%]" />
              <col className="w-[5%]" />
              <col className="w-[5%]" />
              <col className="w-[7%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead className="text-[11px] text-slate-500">
              <tr className="border-b border-slate-200">
                <th
                  colSpan={4}
                  className="bg-white px-2 py-1.5 text-center text-[10px] font-bold tracking-wide text-slate-600"
                >
                  제품 정보
                </th>
                <th
                  colSpan={4}
                  className="border-r-2 border-l-2 border-gray-300 bg-slate-100/80 px-1 py-1.5 text-center text-[10px] font-bold tracking-wide text-slate-700"
                >
                  재고 관리
                </th>
                <th
                  colSpan={4}
                  className="border-r-2 border-gray-300 bg-emerald-50/60 px-1 py-1.5 text-center text-[10px] font-bold tracking-wide text-emerald-800"
                >
                  판매 기록
                </th>
                <th
                  rowSpan={2}
                  className="bg-white px-1.5 py-1.5 text-center align-middle font-semibold"
                >
                  관리
                </th>
              </tr>
              <tr className="bg-slate-50/80">
                <th className="whitespace-nowrap px-2 py-1.5 font-semibold">
                  브랜드
                </th>
                <th className="px-2 py-1.5 font-semibold">제품명</th>
                <th className="whitespace-nowrap px-1 py-1.5 text-center font-semibold">
                  구분
                </th>
                <th className="whitespace-nowrap border-r-2 border-gray-300 px-1 py-1.5 text-center font-semibold">
                  가격
                </th>
                <th className="whitespace-nowrap bg-slate-50/50 px-0.5 py-1.5 text-center font-semibold text-violet-700">
                  초기
                </th>
                <th className="whitespace-nowrap bg-slate-50/50 px-0.5 py-1.5 text-center font-semibold">
                  백업
                </th>
                <th className="w-8 whitespace-nowrap bg-slate-50/50 px-0 py-1.5 text-center font-semibold">
                  <span className="sr-only">이동</span>
                </th>
                <th className="whitespace-nowrap border-r-2 border-gray-300 bg-slate-50/50 px-0.5 py-1.5 text-center font-semibold">
                  샵
                </th>
                <th className="whitespace-nowrap bg-emerald-50/30 px-0.5 py-1.5 text-center font-semibold text-slate-600">
                  1일차
                </th>
                <th className="whitespace-nowrap bg-emerald-50/30 px-0.5 py-1.5 text-center font-semibold text-slate-600">
                  2일차
                </th>
                <th className="whitespace-nowrap bg-emerald-50/30 px-0.5 py-1.5 text-center font-semibold text-slate-600">
                  3일차
                </th>
                <th className="whitespace-nowrap border-r-2 border-gray-300 bg-emerald-50/50 px-0.5 py-1.5 text-center font-bold text-emerald-800">
                  총판매
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={13}
                    className="px-2 py-12 text-center text-sm text-slate-500"
                  >
                    조건에 맞는 제품이 없습니다.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  return (
                    <tr
                      key={row.id}
                      className="border-t border-slate-100 transition hover:bg-slate-50/60"
                    >
                      <td className="whitespace-nowrap px-2 py-1.5 align-top font-medium text-slate-700">
                        {row.brand}
                      </td>
                      <td className="min-w-[300px] px-2 py-1.5 align-top">
                        <div className="flex items-start gap-1.5">
                          <span className="whitespace-normal break-words font-semibold leading-snug text-slate-900">
                            {row.name}
                          </span>
                          <StockStatusBadge totalQty={row.totalQty} />
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-1 py-1.5 text-center align-top">
                        <span
                          className={[
                            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            row.companyType === "자사"
                              ? "bg-sky-50 text-sky-700"
                              : "bg-amber-50 text-amber-700",
                          ].join(" ")}
                        >
                          {row.companyType}
                        </span>
                      </td>
                      <EditablePriceCell
                        productId={row.id}
                        price={row.price}
                        onUpdated={handlePriceUpdated}
                        cellClassName="border-r-2 border-gray-300 align-top"
                      />
                      <td
                        className="w-16 whitespace-nowrap bg-slate-50/50 px-0.5 py-1.5 text-center align-top tabular-nums font-bold text-violet-800"
                        title="샵 + 백업 + 총 판매량"
                      >
                        {row.initialQty}
                      </td>
                      <EditableQtyCell
                        productId={row.id}
                        field="backup_qty"
                        value={row.backupQty}
                        label="백업 재고"
                        onUpdated={handleQtyUpdated}
                        cellClassName="bg-slate-50/50 align-top"
                      />
                      <td className="w-8 bg-slate-50/50 px-0 py-1.5 text-center align-top">
                        <button
                          type="button"
                          onClick={() => setMoveTarget(row)}
                          title="백업 ↔ 샵 재고 이동"
                          aria-label={`${row.name} 재고 이동`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-slate-400 transition hover:bg-white/80 hover:text-slate-700 active:bg-slate-200"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path d="m16 3 4 4-4 4" />
                            <path d="M20 7H4" />
                            <path d="m8 21-4-4 4-4" />
                            <path d="M4 17h16" />
                          </svg>
                        </button>
                      </td>
                      <EditableQtyCell
                        productId={row.id}
                        field="storage_qty"
                        value={row.storageQty}
                        label="샵 재고"
                        onUpdated={handleQtyUpdated}
                        cellClassName="border-r-2 border-gray-300 bg-slate-50/50 align-top"
                      />
                      <td className="w-14 whitespace-nowrap bg-emerald-50/30 px-0.5 py-1.5 text-center align-top tabular-nums text-slate-700">
                        {row.soldDay1 || "—"}
                      </td>
                      <td className="w-14 whitespace-nowrap bg-emerald-50/30 px-0.5 py-1.5 text-center align-top tabular-nums text-slate-700">
                        {row.soldDay2 || "—"}
                      </td>
                      <td className="w-14 whitespace-nowrap bg-emerald-50/30 px-0.5 py-1.5 text-center align-top tabular-nums text-slate-700">
                        {row.soldDay3 || "—"}
                      </td>
                      <td className="w-16 whitespace-nowrap border-r-2 border-gray-300 bg-emerald-50/50 px-0.5 py-1.5 text-center align-top tabular-nums font-bold text-emerald-700">
                        {row.soldQty}
                      </td>
                      <td className="whitespace-nowrap px-1.5 py-1.5 align-top">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => setSaleTarget(row)}
                            className="min-h-8 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700"
                          >
                            판매
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === row.id}
                            onClick={() => void handleDelete(row)}
                            className="rounded-lg p-1.5 text-rose-300 transition hover:bg-rose-50 hover:text-rose-400 disabled:opacity-60"
                            title="삭제"
                            aria-label="삭제"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193v-.443A2.75 2.75 0 0011.25 1h-2.5zM10 4c.784 0 1.559.02 2.319.06V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.31A41.4 41.4 0 0110 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 001.498-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.498-.06l.3 7.5a.75.75 0 101.498.06l.3-7.5z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <StockMoveModal
        open={Boolean(moveTarget)}
        row={moveTarget}
        onClose={() => setMoveTarget(null)}
        onSuccess={handleDataChanged}
      />

      <SaleModal
        open={Boolean(saleTarget)}
        row={saleTarget}
        eventDay={eventDay}
        onClose={() => setSaleTarget(null)}
        onSuccess={handleSaleSuccess}
      />

      <RecentActivityPanel
        refreshKey={activityRefreshKey}
        onUndone={handleDataChanged}
        onRegisterRemoveById={(removeById) => {
          removeActivityByIdRef.current = removeById;
        }}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
