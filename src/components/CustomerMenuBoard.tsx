"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchInventoryDashboardData } from "@/lib/fetchInventory";
import { supabase } from "@/lib/supabase";
import type { DashboardRow } from "@/types/dashboard";

/** 제조사 필터 UI 값 → DB company_type 매핑 */
type CompanyFilterValue = "전체" | "자사" | "타사";
type LiquorFilterValue =
  | "전체"
  | "위스키"
  | "브랜디"
  | "럼"
  | "리큐르"
  | "기타";

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

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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

function companyLabel(companyType: string): string {
  return COMPANY_LABELS[companyType] ?? companyType;
}

function groupFilteredProducts(rows: DashboardRow[]): CompanyGroup[] {
  const byCompany = new Map<string, Map<string, DashboardRow[]>>();

  for (const row of rows) {
    const companyKey = row.companyType || "기타";
    const brandKey = row.brand || "미지정";

    if (!byCompany.has(companyKey)) {
      byCompany.set(companyKey, new Map());
    }
    const brandMap = byCompany.get(companyKey)!;
    if (!brandMap.has(brandKey)) {
      brandMap.set(brandKey, []);
    }
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
      const soldOutCount = products.filter((p) => p.storageQty === 0).length;
      return {
        brand,
        products,
        totalCount: products.length,
        soldOutCount,
      };
    });

    const totalCount = brands.reduce((sum, b) => sum + b.totalCount, 0);
    const soldOutCount = brands.reduce((sum, b) => sum + b.soldOutCount, 0);

    return {
      companyType,
      label: companyLabel(companyType),
      brands,
      totalCount,
      soldOutCount,
    };
  });
}

function PillButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "shrink-0 rounded-full px-3.5 py-2 text-xs font-semibold transition sm:text-sm",
        active
          ? "bg-slate-900 text-white shadow-sm"
          : "border border-slate-200 bg-white text-slate-700 hover:border-slate-300",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function ProductStatusBadges({ row }: { row: DashboardRow }) {
  const soldOut = row.storageQty === 0;
  const lowStock = row.storageQty > 0 && row.storageQty <= 2;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {soldOut && (
        <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
          품절
        </span>
      )}
      {lowStock && (
        <span className="rounded-md bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
          품절 임박
        </span>
      )}
      {row.liquorType ? (
        <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
          {row.liquorType}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 아임웹 iframe용 고객 열람(Read-only) 재고 현황.
 * 가격·재고 숫자는 UI에 노출하지 않음.
 */
export default function CustomerMenuBoard() {
  const [products, setProducts] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] =
    useState<CompanyFilterValue>("전체");
  const [liquorFilter, setLiquorFilter] = useState<LiquorFilterValue>("전체");

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

  const filteredProducts = useMemo(() => {
    return products.filter((row) => {
      if (companyFilter !== "전체" && row.companyType !== companyFilter) {
        return false;
      }
      if (!matchesLiquorFilter(row.liquorType, liquorFilter)) {
        return false;
      }
      return true;
    });
  }, [products, companyFilter, liquorFilter]);

  const companyGroups = useMemo(
    () => groupFilteredProducts(filteredProducts),
    [filteredProducts]
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white px-3 pb-3 pt-4 sm:px-4">
        <div className="text-center">
          <h1 className="text-xl font-extrabold leading-tight tracking-tight text-slate-900 whitespace-pre-line sm:text-2xl">
            {"스페이스 샵 4주년\n구매 가능 리스트"}
          </h1>
          <p className="mt-2 text-xs text-slate-500 sm:text-sm">
            스페이스 컴퍼니 코리아 제품과 타사 제품 라인업입니다.
          </p>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
            {COMPANY_PILLS.map((pill) => (
              <PillButton
                key={pill.value}
                label={pill.label}
                active={companyFilter === pill.value}
                onClick={() => setCompanyFilter(pill.value)}
              />
            ))}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
            {LIQUOR_PILLS.map((pill) => (
              <PillButton
                key={pill.value}
                label={pill.label}
                active={liquorFilter === pill.value}
                onClick={() => setLiquorFilter(pill.value)}
              />
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 sm:px-4 sm:py-4">
        {error && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-6">
            <div className="h-8 w-64 animate-pulse rounded bg-slate-200/80" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="h-48 animate-pulse rounded-2xl bg-slate-200/70"
                />
              ))}
            </div>
          </div>
        ) : companyGroups.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">
            표시할 제품이 없습니다
          </p>
        ) : (
          <div className="space-y-8">
            {companyGroups.map((company) => (
              <section key={company.companyType}>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-600"
                      aria-hidden
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="h-5 w-5"
                      >
                        <path d="M3.375 3C2.339 3 1.5 3.84 1.5 4.875v.75c0 1.036.84 1.875 1.875 1.875h17.25c1.035 0 1.875-.84 1.875-1.875v-.75C22.5 3.839 21.66 3 20.625 3H3.375Z" />
                        <path
                          fillRule="evenodd"
                          d="m3.087 9 .54 9.176A3 3 0 0 0 6.62 21h10.757a3 3 0 0 0 2.995-2.824L20.913 9H3.087Zm6.163 3.75A.75.75 0 0 1 10 12h4a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </span>
                    <h2 className="truncate text-lg font-extrabold text-slate-900 sm:text-xl">
                      {company.label}
                    </h2>
                  </div>
                  <p className="shrink-0 text-xs text-slate-500 sm:text-sm">
                    총 {company.totalCount}개 품목 (품절 {company.soldOutCount}
                    개)
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {company.brands.map((brandGroup) => (
                    <article
                      key={`${company.companyType}-${brandGroup.brand}`}
                      className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 px-3.5 py-3">
                        <h3 className="min-w-0 truncate text-base font-bold text-slate-900">
                          {brandGroup.brand}
                        </h3>
                        <span className="shrink-0 text-sm font-semibold text-sky-600">
                          {brandGroup.totalCount}개
                        </span>
                      </div>

                      <ul className="divide-y divide-slate-50 px-2 py-1">
                        {brandGroup.products.map((row) => {
                          const soldOut = row.storageQty === 0;
                          return (
                            <li
                              key={row.id}
                              className="flex items-start gap-2 px-1.5 py-2.5 select-none"
                            >
                              <p
                                className={[
                                  "min-w-0 flex-1 text-sm leading-snug",
                                  soldOut
                                    ? "text-slate-400 line-through"
                                    : "font-medium text-slate-800",
                                ].join(" ")}
                              >
                                {row.name}
                              </p>
                              <ProductStatusBadges row={row} />
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
    </div>
  );
}
