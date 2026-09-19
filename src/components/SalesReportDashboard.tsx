"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import RealtimeSalesTimeline from "@/components/RealtimeSalesTimeline";
import SettlementReportTemplate, {
  downloadSettlementPdf,
} from "@/components/SettlementReportTemplate";
import { useEventDay } from "@/hooks/useEventDay";
import {
  buildSettlementReport,
  type SettlementReportData,
  type SettlementScope,
} from "@/lib/buildSettlementReport";
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
  const { eventDay } = useEventDay();
  const [report, setReport] = useState<SalesReportSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settlementData, setSettlementData] =
    useState<SettlementReportData | null>(null);
  const [exporting, setExporting] = useState<SettlementScope | null>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

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

  async function handleExportPdf(scope: SettlementScope) {
    if (exporting) return;
    setExporting(scope);
    try {
      const data = await buildSettlementReport(scope, eventDay);
      flushSync(() => {
        setSettlementData(data);
      });

      // React 렌더 완료 대기 후 캡처
      await new Promise((resolve) => setTimeout(resolve, 500));

      const el = pdfRef.current;
      if (!el) {
        throw new Error("PDF 템플릿을 찾을 수 없습니다.");
      }

      const filename =
        scope === "today" ? "report_today.pdf" : "report_all_3days.pdf";
      await downloadSettlementPdf(el, filename);
    } catch (err) {
      console.error("[Settlement PDF] 실패", err);
      const message =
        err instanceof Error ? err.message : "PDF 생성에 실패했습니다.";
      window.alert(message);
    } finally {
      setExporting(null);
    }
  }

  const maxDayRevenue = Math.max(
    ...(report?.byDay.map((day) => day.revenue) ?? [0]),
    1
  );
  const ownPlusOther = (report?.ownRevenue ?? 0) + (report?.otherRevenue ?? 0);

  return (
    <div className="relative mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            매출 보고서
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            전체 행사 기간의 판매 기록을 종합해 실시간으로 확인하세요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => void handleExportPdf("today")}
            className="inline-flex items-center justify-center rounded-xl bg-sky-600 px-3.5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {exporting === "today"
              ? "PDF 생성 중…"
              : "📄 금일 정산 리포트 PDF"}
          </button>
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => void handleExportPdf("all")}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting === "all"
              ? "PDF 생성 중…"
              : "📊 3일 전체 정산 리포트 PDF"}
          </button>
        </div>
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
                기존 랭킹 · 1~3일차 판매량 추가
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">
                      랭킹
                    </th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">
                      제품명
                    </th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">
                      브랜드
                    </th>
                    <th className="whitespace-nowrap px-3 py-3 font-semibold">
                      구분
                    </th>
                    <th className="whitespace-nowrap px-2 py-3 text-center font-semibold">
                      1일차
                    </th>
                    <th className="whitespace-nowrap px-2 py-3 text-center font-semibold">
                      2일차
                    </th>
                    <th className="whitespace-nowrap px-2 py-3 text-center font-semibold">
                      3일차
                    </th>
                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">
                      총 판매량
                    </th>
                    <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">
                      총 발생 매출
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.ranking.length === 0 ? (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-16 text-center text-slate-500"
                      >
                        아직 판매 기록이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    report.ranking.slice(0, 10).map((item, index) => (
                      <tr
                        key={item.productId}
                        className="border-t border-slate-100 transition hover:bg-slate-50/80"
                      >
                        <td className="whitespace-nowrap px-3 py-3">
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
                        <td className="min-w-[10rem] px-3 py-3 font-semibold text-slate-900">
                          {item.productName}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-slate-700">
                          {item.brand}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
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
                        <td className="whitespace-nowrap px-2 py-3 text-center tabular-nums text-slate-700">
                          {item.day1Sales || "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-center tabular-nums text-slate-700">
                          {item.day2Sales || "—"}
                        </td>
                        <td className="whitespace-nowrap px-2 py-3 text-center tabular-nums text-slate-700">
                          {item.day3Sales || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums font-semibold text-slate-900">
                          {formatNumber(item.quantity)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums font-semibold text-emerald-700">
                          {formatCurrency(item.revenue)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {report.ranking.length > 0 ? (
              <p className="border-t border-slate-100 px-5 py-3 text-xs text-gray-400">
                ※ 상위 10개 품목만 표시됩니다.
              </p>
            ) : null}
          </section>
        </div>
      )}

      {/* PDF 1페이지 미리보기/캡처 템플릿 — 항상 렌더 */}
      <div className="mt-12 border-t border-slate-200 pt-6">
        <p className="mb-3 text-xs font-medium text-slate-400">
          PDF 미리보기 (다운로드와 동일한 1페이지 리포트)
        </p>
        <SettlementReportTemplate ref={pdfRef} data={settlementData} />
      </div>
    </div>
  );
}
