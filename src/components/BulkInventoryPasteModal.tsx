"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  annotateDraftRows,
  applyBulkPasteRows,
  fetchExistingProductsForMatch,
  parseBulkPasteText,
  rematchDraftRow,
  type BulkPasteDraftRow,
  type ExistingProductRef,
  type MatchStatus,
} from "@/lib/bulkInventoryPaste";

type Step = "paste" | "preview";

function StatusBadge({ row }: { row: BulkPasteDraftRow }) {
  if (row.parseError) {
    return (
      <span className="inline-flex rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
        오류
      </span>
    );
  }

  if (row.status === "exact") {
    return (
      <span className="inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
        기존 추가
      </span>
    );
  }

  if (row.status === "similar") {
    return (
      <span className="inline-flex max-w-[14rem] flex-col gap-0.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
        <span>유사 주의</span>
        {row.matchedProductName ? (
          <span className="truncate font-medium text-amber-700/90">
            → {row.matchedProductName}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      신규 등록
    </span>
  );
}

function statusLabel(status: MatchStatus): string {
  if (status === "exact") return "기존";
  if (status === "similar") return "유사";
  return "신규";
}

export default function BulkInventoryPasteModal({
  open,
  onClose,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const [step, setStep] = useState<Step>("paste");
  const [rawText, setRawText] = useState("");
  const [rows, setRows] = useState<BulkPasteDraftRow[]>([]);
  const [products, setProducts] = useState<ExistingProductRef[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = useMemo(
    () => rows.filter((r) => r.selected && !r.parseError).length,
    [rows]
  );

  const priceConflictCount = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.selected &&
          r.priceConflict &&
          r.resolveAs === "merge" &&
          !r.parseError
      ).length,
    [rows]
  );

  useEffect(() => {
    if (!open) return;

    setStep("paste");
    setRawText("");
    setRows([]);
    setError(null);
    setApplying(false);
    setParsing(false);

    let cancelled = false;
    setLoadingProducts(true);
    void fetchExistingProductsForMatch()
      .then((list) => {
        if (!cancelled) setProducts(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "기존 제품 목록을 불러오지 못했습니다."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleParse = useCallback(() => {
    setError(null);
    const trimmed = rawText.trim();
    if (!trimmed) {
      setError("붙여넣을 데이터를 입력해 주세요.");
      return;
    }

    setParsing(true);
    try {
      const parsed = parseBulkPasteText(trimmed);
      if (parsed.length === 0) {
        setError("유효한 행이 없습니다.");
        return;
      }
      setRows(annotateDraftRows(parsed, products));
      setStep("preview");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "파싱 중 오류가 발생했습니다."
      );
    } finally {
      setParsing(false);
    }
  }, [rawText, products]);

  const updateRow = useCallback(
    (id: string, patch: Partial<BulkPasteDraftRow>) => {
      setRows((prev) =>
        prev.map((row) => {
          if (row.id !== id) return row;
          const next = { ...row, ...patch };
          if (patch.name != null || patch.price != null) {
            return rematchDraftRow(next, products);
          }
          return next;
        })
      );
    },
    [products]
  );

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  }, []);

  const toggleAll = useCallback((checked: boolean) => {
    setRows((prev) =>
      prev.map((row) =>
        row.parseError ? row : { ...row, selected: checked }
      )
    );
  }, []);

  const handleApply = useCallback(async () => {
    if (selectedCount === 0 || applying) return;

    if (priceConflictCount > 0) {
      const ok = window.confirm(
        `가격이 다른 기존 품목이 ${priceConflictCount}건 있습니다.\n붙여넣은 최신 가격으로 덮어쓰며 재고를 더할까요?`
      );
      if (!ok) return;
    }

    setApplying(true);
    setError(null);

    try {
      const summary = await applyBulkPasteRows(rows, { overwritePrice: true });
      const parts = [
        summary.merged > 0 ? `기존 합산 ${summary.merged}건` : null,
        summary.inserted > 0 ? `신규 ${summary.inserted}건` : null,
        summary.skipped > 0 ? `실패 ${summary.skipped}건` : null,
      ].filter(Boolean);

      window.alert(
        `반영 완료\n${parts.join(" · ") || "처리된 항목 없음"}${
          summary.errors.length
            ? `\n\n오류:\n${summary.errors.slice(0, 5).join("\n")}`
            : ""
        }`
      );

      onApplied?.();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "반영 중 오류가 발생했습니다."
      );
    } finally {
      setApplying(false);
    }
  }, [
    applying,
    onApplied,
    onClose,
    priceConflictCount,
    rows,
    selectedCount,
  ]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-paste-title"
        className="relative z-10 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2
              id="bulk-paste-title"
              className="text-lg font-bold text-slate-900"
            >
              일괄 재고 추가 · 스마트 검토
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              엑셀/텍스트를 붙여넣은 뒤 기존·유사·신규를 검토하고 반영합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="모달 닫기"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          {step === "paste" ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                형식:{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">
                  브랜드 | 제품명 | 가격 | 백업(창고)수량 | 매장수량
                </code>
                <span className="ml-1">
                  (Tab / 콤마 / | 구분, 한 줄에 한 품목)
                </span>
              </p>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={
                  "예)\n맥캘란\t맥캘란 12년\t180000\t10\t5\n발베니,발베니 12년,160000,8,3"
                }
                rows={14}
                className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:ring-4 focus:ring-sky-100"
                disabled={loadingProducts || parsing}
              />
              {loadingProducts ? (
                <p className="text-xs text-slate-400">
                  기존 제품 목록 불러오는 중…
                </p>
              ) : (
                <p className="text-xs text-slate-400">
                  비교 대상 기존 제품 {products.length}개
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-sky-50 px-2 py-0.5 font-semibold text-sky-700">
                  기존{" "}
                  {rows.filter((r) => r.status === "exact" && !r.parseError).length}
                </span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">
                  유사{" "}
                  {
                    rows.filter((r) => r.status === "similar" && !r.parseError)
                      .length
                  }
                </span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                  신규{" "}
                  {rows.filter((r) => r.status === "new" && !r.parseError).length}
                </span>
                <button
                  type="button"
                  onClick={() => setStep("paste")}
                  className="ml-auto text-sky-600 underline-offset-2 hover:underline"
                >
                  ← 붙여넣기 다시 수정
                </button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-50 text-[11px] text-slate-500">
                    <tr>
                      <th className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={
                            rows.length > 0 &&
                            rows
                              .filter((r) => !r.parseError)
                              .every((r) => r.selected)
                          }
                          onChange={(e) => toggleAll(e.target.checked)}
                          aria-label="전체 선택"
                        />
                      </th>
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">
                        상태
                      </th>
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">
                        브랜드
                      </th>
                      <th className="min-w-[12rem] px-2 py-2 font-semibold">
                        제품명
                      </th>
                      <th className="whitespace-nowrap px-2 py-2 text-right font-semibold">
                        가격
                      </th>
                      <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">
                        백업
                      </th>
                      <th className="whitespace-nowrap px-2 py-2 text-center font-semibold">
                        매장
                      </th>
                      <th className="whitespace-nowrap px-2 py-2 font-semibold">
                        처리
                      </th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={9}
                          className="px-3 py-10 text-center text-slate-500"
                        >
                          미리볼 행이 없습니다.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => (
                        <tr
                          key={row.id}
                          className={[
                            "border-t border-slate-100",
                            row.parseError ? "bg-rose-50/40" : "",
                            !row.selected ? "opacity-50" : "",
                          ].join(" ")}
                        >
                          <td className="px-2 py-1.5 align-top">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={Boolean(row.parseError)}
                              onChange={(e) =>
                                updateRow(row.id, {
                                  selected: e.target.checked,
                                })
                              }
                              aria-label={`${row.name} 선택`}
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <StatusBadge row={row} />
                            {row.parseError ? (
                              <p className="mt-1 text-[10px] text-rose-600">
                                {row.parseError}
                              </p>
                            ) : null}
                            {row.priceConflict && row.resolveAs === "merge" ? (
                              <p className="mt-1 text-[10px] text-amber-700">
                                기존가{" "}
                                {row.matchedPrice?.toLocaleString("ko-KR")}원 →
                                덮어씀
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input
                              value={row.brand}
                              onChange={(e) =>
                                updateRow(row.id, { brand: e.target.value })
                              }
                              className="w-24 rounded border border-slate-200 px-1.5 py-1 text-xs outline-none focus:border-sky-400"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <input
                              value={row.name}
                              onBlur={(e) =>
                                updateRow(row.id, {
                                  name: e.target.value.trim(),
                                })
                              }
                              onChange={(e) =>
                                setRows((prev) =>
                                  prev.map((r) =>
                                    r.id === row.id
                                      ? { ...r, name: e.target.value }
                                      : r
                                  )
                                )
                              }
                              className="w-full min-w-[10rem] rounded border border-slate-200 px-1.5 py-1 text-xs font-medium outline-none focus:border-sky-400"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top text-right">
                            <input
                              type="number"
                              min={0}
                              value={row.price}
                              onChange={(e) =>
                                updateRow(row.id, {
                                  price: Number(e.target.value) || 0,
                                })
                              }
                              className="w-24 rounded border border-slate-200 px-1.5 py-1 text-right text-xs outline-none focus:border-sky-400"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top text-center">
                            <input
                              type="number"
                              min={0}
                              value={row.backupQty}
                              onChange={(e) =>
                                updateRow(row.id, {
                                  backupQty: Math.max(
                                    0,
                                    Math.floor(Number(e.target.value) || 0)
                                  ),
                                })
                              }
                              className="w-16 rounded border border-slate-200 px-1 py-1 text-center text-xs outline-none focus:border-sky-400"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top text-center">
                            <input
                              type="number"
                              min={0}
                              value={row.storageQty}
                              onChange={(e) =>
                                updateRow(row.id, {
                                  storageQty: Math.max(
                                    0,
                                    Math.floor(Number(e.target.value) || 0)
                                  ),
                                })
                              }
                              className="w-16 rounded border border-slate-200 px-1 py-1 text-center text-xs outline-none focus:border-sky-400"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            {row.status === "similar" && !row.parseError ? (
                              <select
                                value={row.resolveAs}
                                onChange={(e) =>
                                  updateRow(row.id, {
                                    resolveAs: e.target.value as
                                      | "merge"
                                      | "create",
                                  })
                                }
                                className="rounded border border-slate-200 px-1.5 py-1 text-[11px] outline-none"
                              >
                                <option value="merge">
                                  기존에 합산 ({statusLabel(row.status)})
                                </option>
                                <option value="create">신규로 등록</option>
                              </select>
                            ) : row.status === "exact" ? (
                              <span className="text-[11px] text-sky-700">
                                재고 합산
                              </span>
                            ) : (
                              <span className="text-[11px] text-emerald-700">
                                INSERT
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-top">
                            <button
                              type="button"
                              onClick={() => removeRow(row.id)}
                              className="rounded px-1.5 py-1 text-[11px] font-medium text-rose-500 transition hover:bg-rose-50"
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            취소
          </button>
          {step === "paste" ? (
            <button
              type="button"
              disabled={loadingProducts || parsing || !rawText.trim()}
              onClick={handleParse}
              className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-sky-700 disabled:opacity-50"
            >
              {parsing ? "검토 중…" : "미리보기 검토"}
            </button>
          ) : (
            <button
              type="button"
              disabled={applying || selectedCount === 0}
              onClick={() => void handleApply()}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {applying
                ? "반영 중…"
                : `선택된 ${selectedCount}건 최종 반영하기`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
