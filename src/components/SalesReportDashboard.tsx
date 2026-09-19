"use client";

import { useEffect, useState } from "react";
import RealtimeSalesTimeline from "@/components/RealtimeSalesTimeline";
import { fetchSalesReport } from "@/lib/fetchSalesReport";
import { supabase } from "@/lib/supabase";
import type { SalesReportSummary } from "@/types/salesReport";

function formatCurrency(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-2xl bg-slate-200/70"
          />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-2xl bg-slate-200/70" />
      <div className="h-80 animate-pulse rounded-2xl bg-slate-200/70" />
    </div>
  );
}

function ProgressBar({
  value,
  max,
  colorClass,
}: {
  value: number;
  max: number;
  colorClass: string;
}) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;

  return (
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full transition-all ${colorClass}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export default function SalesReportDashboard() {
  const [report, setReport] = useState<SalesReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load(options?: { silent?: boolean }) {
    if (!options?.silent) {
      setLoading(true);
      setError(null);
    }

    try {
      const data = await fetchSalesReport();
      setReport(data);
    } catch (err) {
      if (options?.silent) {
        console.error("[Report] silent refresh 실패", err);
        return;
      }
      const message =
        err instanceof Error
          ? err.message
          : "매출 보고서를 불러오지 못했습니다.";
      console.error(err);
      setError(message);
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
      .channel("realtime:sales_report")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_logs" },
        (payload) => {
          console.log("📊 보고서 판매 실시간 수신:", payload);
          if (timer != null) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            void load({ silent: true });
          }, 100);
        }
      )
      .subscribe((status) => {
        console.log("✅ Report Realtime Status:", status);
      });

    return () => {
      if (timer != null) window.clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, []);

  const maxDayRevenue = Math.max(
    ...(report?.byDay.map((day) => day.revenue) ?? [0]),
    1
  );
  const ownPlusOther = (report?.ownRevenue ?? 0) + (report?.otherRevenue ?? 0);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          매출 보고서
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          전체 행사 기간의 판매 기록을 종합해 실시간으로 확인하세요.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-800"
        >
          <p className="font-semibold">데이터 불러오기 실패</p>
          <p className="mt-1 text-sm">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white"
          >
            다시 시도
          </button>
        </div>
      )}

      {loading || !report ? (
        <ReportSkeleton />
      ) : (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-500">총 누적 매출</p>
              <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {formatCurrency(report.totalRevenue)}
              </p>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-slate-500">총 판매 수량</p>
              <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {formatNumber(report.totalQuantity)}
                <span className="ml-1 text-base font-semibold text-slate-500">
                  개
                </span>
              </p>
            </article>

            <article className="rounded-2xl border border-sky-100 bg-sky-50/70 p-5 shadow-sm">
              <p className="text-sm font-medium text-sky-700">자사 제품 매출</p>
              <p className="mt-3 text-2xl font-bold tracking-tight text-sky-900">
                {formatCurrency(report.ownRevenue)}
              </p>
              <p className="mt-2 text-xs text-sky-700/80">
                전체 대비{" "}
                {ownPlusOther > 0
                  ? Math.round((report.ownRevenue / ownPlusOther) * 100)
                  : 0}
                %
              </p>
            </article>

            <article className="rounded-2xl border border-amber-100 bg-amber-50/70 p-5 shadow-sm">
              <p className="text-sm font-medium text-amber-700">타사 제품 매출</p>
              <p className="mt-3 text-2xl font-bold tracking-tight text-amber-900">
                {formatCurrency(report.otherRevenue)}
              </p>
              <p className="mt-2 text-xs text-amber-700/80">
                전체 대비{" "}
                {ownPlusOther > 0
                  ? Math.round((report.otherRevenue / ownPlusOther) * 100)
                  : 0}
                %
              </p>
            </article>
          </section>

          <section>
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-slate-900">
                  일자별 매출 현황
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  1~3일차 판매 수량과 매출액
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {report.byDay.map((day) => (
                  <div
                    key={day.dayNumber}
                    className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-slate-800">
                        {day.dayNumber}일차
                      </p>
                      <p className="text-sm font-semibold text-slate-900">
                        {formatCurrency(day.revenue)}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      판매 {formatNumber(day.quantity)}개
                    </p>
                    <ProgressBar
                      value={day.revenue}
                      max={maxDayRevenue}
                      colorClass="bg-sky-500"
                    />
                  </div>
                ))}
              </div>
            </article>
          </section>

          <RealtimeSalesTimeline />

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">
                개별 제품 판매 랭킹
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                판매 수량 기준 내림차순
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-3.5 font-semibold">
                      랭킹
                    </th>
                    <th className="whitespace-nowrap px-4 py-3.5 font-semibold">
                      제품명
                    </th>
                    <th className="whitespace-nowrap px-4 py-3.5 font-semibold">
                      브랜드
                    </th>
                    <th className="whitespace-nowrap px-4 py-3.5 font-semibold">
                      구분
                    </th>
                    <th className="whitespace-nowrap px-4 py-3.5 text-right font-semibold">
                      총 판매 수량
                    </th>
                    <th className="whitespace-nowrap px-4 py-3.5 text-right font-semibold">
                      총 발생 매출
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.ranking.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-16 text-center text-slate-500"
                      >
                        아직 판매 기록이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    report.ranking.map((item, index) => (
                      <tr
                        key={item.productId}
                        className="border-t border-slate-100 transition hover:bg-slate-50/80"
                      >
                        <td className="whitespace-nowrap px-4 py-3.5">
                          <span
                            className={[
                              "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                              index === 0
                                ? "bg-amber-100 text-amber-800"
                                : index === 1
                                  ? "bg-slate-200 text-slate-700"
                                  : index === 2
                                    ? "bg-orange-100 text-orange-800"
                                    : "bg-slate-100 text-slate-600",
                            ].join(" ")}
                          >
                            {index + 1}
                          </span>
                        </td>
                        <td className="min-w-[12rem] px-4 py-3.5 font-semibold text-slate-900">
                          {item.productName}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-slate-700">
                          {item.brand}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5">
                          <span
                            className={[
                              "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                              item.companyType === "자사"
                                ? "bg-sky-50 text-sky-700"
                                : "bg-amber-50 text-amber-700",
                            ].join(" ")}
                          >
                            {item.companyType}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums font-semibold text-slate-900">
                          {formatNumber(item.quantity)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums font-semibold text-emerald-700">
                          {formatCurrency(item.revenue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
