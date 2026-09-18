"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchInventoryDashboardData } from "@/lib/fetchInventory";
import { supabase } from "@/lib/supabase";
import type { DashboardRow } from "@/types/dashboard";

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export default function ReplenishBoard() {
  const [products, setProducts] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const data = await fetchInventoryDashboardData(undefined, {
        orderBy: "created",
      });
      setProducts(data.rows);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "재고 데이터를 불러오지 못했습니다.";
      console.error(err);
      if (!options?.silent) setError(message);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let timer: number | null = null;

    const channel = supabase
      .channel("realtime:replenish")
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
              void load({ silent: true });
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

  const urgent = useMemo(
    () =>
      products.filter(
        (row) => row.backupQty > 0 && row.storageQty <= 2
      ),
    [products]
  );

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          물류 보충
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          샵 재고 2개 이하 · 백업 재고 있는 제품만 표시
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="h-20 animate-pulse rounded-2xl bg-slate-200/70"
            />
          ))}
        </div>
      ) : urgent.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 px-6 py-16 text-center">
          <p className="text-lg font-semibold text-emerald-900">
            지금 보충할 제품이 없습니다
          </p>
          <p className="mt-1 text-sm text-emerald-700/80">
            샵 재고가 충분하거나 백업이 없는 상태입니다
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {urgent.map((row) => (
            <li
              key={row.id}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
            >
              <p className="text-xs font-medium text-slate-400">{row.brand}</p>
              <p className="mt-0.5 text-lg font-bold leading-snug text-slate-900">
                {row.name}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold">
                <p>
                  <span className="text-slate-500">샵 </span>
                  <span className="text-base font-bold text-rose-600">
                    {row.storageQty}개
                  </span>
                </p>
                <span className="text-slate-300">/</span>
                <p>
                  <span className="text-slate-500">창고 </span>
                  <span className="text-base font-bold text-slate-800">
                    {row.backupQty}개
                  </span>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
