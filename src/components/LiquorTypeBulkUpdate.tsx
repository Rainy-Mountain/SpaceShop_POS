"use client";

import { useState } from "react";
import {
  parseLiquorTypeText,
  updateLiquorTypesFromPairs,
} from "@/lib/updateLiquorTypes";

/** 카드 셸은 페이지에서 제공 — 본문만 렌더 */
export default function LiquorTypeBulkUpdate() {
  const [text, setText] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  async function handleUpdate() {
    setError(null);
    setResultMessage(null);

    const pairs = parseLiquorTypeText(text);
    if (pairs.length === 0) {
      setError(
        "유효한 행이 없습니다. 예: 스페이스 10년, 위스키 (또는 탭으로 구분)"
      );
      return;
    }

    setIsUpdating(true);
    try {
      const summary = await updateLiquorTypesFromPairs(pairs);

      if (summary.errors.length > 0 && summary.updated === 0) {
        setError(summary.errors.slice(0, 3).join("\n"));
        return;
      }

      const parts = [`주종 업데이트가 완료되었습니다 (${summary.updated}건)`];
      if (summary.notFound.length > 0) {
        parts.push(
          `미일치 ${summary.notFound.length}건: ${summary.notFound
            .slice(0, 5)
            .join(", ")}${summary.notFound.length > 5 ? "…" : ""}`
        );
      }
      if (summary.errors.length > 0) {
        parts.push(`오류 ${summary.errors.length}건`);
      }

      const message = parts.join("\n");
      setResultMessage(message);
      window.alert("주종 업데이트가 완료되었습니다");
      setText("");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "주종 업데이트에 실패했습니다.";
      setError(message);
    } finally {
      setIsUpdating(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={isUpdating}
        rows={8}
        placeholder="상품명과 주종을 탭이나 쉼표로 구분해서 붙여넣어주세요. 예: 스페이스 10년, 위스키"
        className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100 disabled:opacity-60"
      />

      <button
        type="button"
        disabled={isUpdating || !text.trim()}
        onClick={() => void handleUpdate()}
        className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {isUpdating ? "업데이트 중…" : "주종 일괄 업데이트"}
      </button>

      {resultMessage && (
        <p
          role="status"
          className="whitespace-pre-line rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {resultMessage}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="whitespace-pre-line rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {error}
        </p>
      )}
    </div>
  );
}
