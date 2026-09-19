"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createManualProduct } from "@/lib/uploadExcel";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-4 focus:ring-sky-100 disabled:opacity-60";

export default function ManualProductForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [storageQty, setStorageQty] = useState("0");
  const [backupQty, setBackupQty] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setPrice("");
    setStorageQty("0");
    setBackupQty("0");
    setError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("제품명을 입력해 주세요.");
      return;
    }

    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      setError("판매 가격은 0 이상의 숫자로 입력해 주세요.");
      return;
    }

    const storageNum = Number(storageQty);
    const backupNum = Number(backupQty);
    if (!Number.isInteger(storageNum) || storageNum < 0) {
      setError("샵 재고 수량은 0 이상의 정수여야 합니다.");
      return;
    }
    if (!Number.isInteger(backupNum) || backupNum < 0) {
      setError("차 재고 수량은 0 이상의 정수여야 합니다.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await createManualProduct({
        name: trimmedName,
        price: priceNum,
        storageQty: storageNum,
        backupQty: backupNum,
      });
      window.alert("신규 품목이 성공적으로 등록되었습니다.");
      resetForm();
      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "제품 등록에 실패했습니다.";
      console.error("[ManualProductForm]", err);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          제품명
        </span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={submitting}
          placeholder="예: 글렌피딕 12년"
          className={inputClass}
          autoComplete="off"
        />
      </label>

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-slate-700">
          판매 가격 (원)
        </span>
        <input
          type="number"
          min={0}
          step={1}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          disabled={submitting}
          placeholder="예: 89000"
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            샵 재고
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={storageQty}
            onChange={(event) => setStorageQty(event.target.value)}
            disabled={submitting}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            차 재고
          </span>
          <input
            type="number"
            min={0}
            step={1}
            value={backupQty}
            onChange={(event) => setBackupQty(event.target.value)}
            disabled={submitting}
            className={inputClass}
          />
        </label>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {submitting ? "등록 중…" : "제품 수동 등록"}
      </button>
    </form>
  );
}
