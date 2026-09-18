"use client";

import { useEffect, useState } from "react";
import { fetchInventoryDashboardData } from "@/lib/fetchInventory";
import { supabase } from "@/lib/supabase";

type SoldOutItem = {
  id: string;
  brand: string;
  name: string;
};

export default function SoldOutBoard() {
  const [items, setItems] = useState<SoldOutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const data = await fetchInventoryDashboardData();
      const soldOut = data.rows
        .filter((row) => row.storageQty + row.backupQty <= 0)
        .map((row) => ({
          id: row.id,
          brand: row.brand,
          name: row.name,
        }))
        .sort((a, b) => {
          const brandCmp = a.brand.localeCompare(b.brand, "ko");
          if (brandCmp !== 0) return brandCmp;
          return a.name.localeCompare(b.name, "ko");
        });
      setItems(soldOut);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "품절 목록을 불러오지 못했습니다.";
      console.error(err);
      if (!options?.silent) setError(message);
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // 재고 변경 시 품절 목록만 조용히 갱신
  useEffect(() => {
    let timer: number | null = null;

    const channel = supabase
      .channel("realtime:soldout-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory" },
        () => {
          if (timer != null) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            void load({ silent: true });
          }, 150);
        }
      )
      .subscribe();

    return () => {
      if (timer != null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="mx-auto min-h-[calc(100vh-4.5rem)] w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-10 text-center">
        <p className="text-sm font-semibold tracking-[0.2em] text-slate-400">
          SOLD OUT
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          품절 안내
        </h1>
        <p className="mt-3 text-base text-slate-500 sm:text-lg">
          현재 준비된 수량이 모두 소진된 제품입니다
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mx-auto mb-8 max-w-lg rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-center text-rose-800"
        >
          <p className="font-semibold">목록을 불러오지 못했습니다</p>
          <p className="mt-1 text-sm">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white"
          >
            다시 시도
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="h-14 animate-pulse rounded-xl bg-slate-200/70"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-20 text-center shadow-sm">
          <p className="text-2xl font-bold text-slate-800 sm:text-3xl">
            현재 품절 제품이 없습니다
          </p>
          <p className="mt-3 text-base text-slate-500 sm:text-lg">
            모든 제품이 준비되어 있습니다
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:gap-3">
          {items.map((product) => (
            <li
              key={product.id}
              className="rounded-xl border border-slate-200/80 bg-white px-3 py-2 shadow-sm"
            >
              <p className="text-xs font-medium text-slate-400">
                {product.brand}
              </p>
              <p className="mt-0.5 text-sm font-semibold leading-snug tracking-tight text-slate-900 sm:text-base">
                {product.name}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
