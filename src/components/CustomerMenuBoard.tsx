"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchInventoryDashboardData } from "@/lib/fetchInventory";
import {
  getBrandInitialKey,
  sortInitialKeys,
} from "@/lib/koreanInitial";
import { supabase } from "@/lib/supabase";
import type { CompanyFilter, DashboardRow } from "@/types/dashboard";

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

/**
 * 아임웹 iframe용 고객 열람(Read-only) 재고 현황.
 * 데이터 페칭·Realtime은 useEffect 안에서만 실행.
 */
export default function CustomerMenuBoard() {
  const [products, setProducts] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>("전체");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedInitial, setSelectedInitial] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchInventoryDashboardData(undefined, {
          orderBy: "created",
        });
        if (!cancelled) setProducts(data.rows);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "재고 현황을 불러오지 못했습니다.";
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
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let timer: number | null = null;

    const channel = supabase
      .channel("realtime:public-menu")
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
              void fetchInventoryDashboardData(undefined, {
                orderBy: "created",
              })
                .then((data) => setProducts(data.rows))
                .catch((err) => console.error(err));
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

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white px-2 py-2 sm:px-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="브랜드·제품 검색"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pr-9 pl-3 text-sm outline-none focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
            />
            {(search || selectedInitial || selectedBrand) && (
              <button
                type="button"
                onClick={clearSearchAndFilters}
                className="absolute top-1/2 right-1.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                aria-label="검색·필터 초기화"
              >
                ✕
              </button>
            )}
          </div>

          <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={[
                "rounded-md px-2.5 py-1.5 text-xs font-semibold",
                viewMode === "grid"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600",
              ].join(" ")}
              aria-label="그리드 보기"
            >
              ⊞
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={[
                "rounded-md px-2.5 py-1.5 text-xs font-semibold",
                viewMode === "list"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600",
              ].join(" ")}
              aria-label="목록 보기"
            >
              ☰
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {COMPANY_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => handleCompanyFilterChange(filter)}
                className={[
                  "rounded-md px-2.5 py-1 text-xs font-semibold",
                  companyFilter === filter
                    ? "bg-sky-600 text-white shadow-sm"
                    : "text-slate-600",
                ].join(" ")}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {availableInitials.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {availableInitials.map((initial) => (
              <button
                key={initial}
                type="button"
                onClick={() => handleSelectInitial(initial)}
                className={[
                  "min-w-8 rounded-md px-2 py-1 text-xs font-bold",
                  selectedInitial === initial
                    ? "bg-sky-600 text-white"
                    : "bg-slate-100 text-slate-700",
                ].join(" ")}
              >
                {initial}
              </button>
            ))}
          </div>
        )}

        {selectedInitial && brandsForInitial.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {brandsForInitial.map((brand) => (
              <button
                key={brand}
                type="button"
                onClick={() => handleSelectBrand(brand)}
                className={[
                  "rounded-md px-2.5 py-1 text-xs font-semibold",
                  selectedBrand === brand
                    ? "bg-sky-600 text-white"
                    : "border border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {brand}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-3">
        {error && (
          <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        )}

        {loading ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
              {Array.from({ length: 9 }).map((_, index) => (
                <div
                  key={index}
                  className="h-32 animate-pulse rounded-xl bg-slate-200/70"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="h-14 animate-pulse rounded-xl bg-slate-200/70"
                />
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">
            표시할 제품이 없습니다
          </p>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
            {filtered.map((row) => {
              const soldOut = row.storageQty <= 0;
              return (
                <div
                  key={row.id}
                  className={[
                    "relative rounded-xl border p-3 select-none",
                    soldOut
                      ? "pointer-events-none border-slate-100 bg-slate-100 opacity-50 grayscale"
                      : "pointer-events-none border-slate-200 bg-white",
                  ].join(" ")}
                  aria-disabled={soldOut}
                >
                  {soldOut && (
                    <span className="absolute top-2 right-2 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                      품절
                    </span>
                  )}
                  <p className="pr-10 text-xs font-medium text-slate-400">
                    {row.brand}
                  </p>
                  <p
                    className={[
                      "mt-1 line-clamp-2 text-sm font-bold leading-snug sm:text-base",
                      soldOut ? "text-slate-500" : "text-slate-900",
                    ].join(" ")}
                  >
                    {row.name}
                  </p>
                  <p
                    className={[
                      "mt-2 text-base font-bold tabular-nums sm:text-lg",
                      soldOut ? "text-slate-400" : "text-sky-700",
                    ].join(" ")}
                  >
                    {formatPrice(row.price)}원
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {filtered.map((row) => {
              const soldOut = row.storageQty <= 0;
              return (
                <li
                  key={row.id}
                  className={[
                    "flex items-center gap-2 rounded-xl border px-3 py-2.5 select-none",
                    soldOut
                      ? "pointer-events-none border-slate-100 bg-slate-100 opacity-50 grayscale"
                      : "pointer-events-none border-slate-200 bg-white",
                  ].join(" ")}
                  aria-disabled={soldOut}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-900">
                      <span className="font-medium text-slate-400">
                        [{row.brand}]
                      </span>{" "}
                      <span className="font-semibold">{row.name}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    {soldOut && (
                      <span className="inline-block rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        품절
                      </span>
                    )}
                    <p
                      className={[
                        "text-sm font-bold tabular-nums",
                        soldOut ? "text-slate-400" : "text-sky-700",
                      ].join(" ")}
                    >
                      {formatPrice(row.price)}원
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
