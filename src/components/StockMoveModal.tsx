"use client";

import { useMemo, useState, type FormEvent } from "react";
import Modal from "@/components/Modal";
import { transferStock } from "@/lib/inventoryActions";
import {
  LOCATION_LABELS,
  UI_STOCK_LOCATIONS,
  type DashboardRow,
  type StockLocation,
} from "@/types/dashboard";

interface StockMoveModalProps {
  open: boolean;
  row: DashboardRow | null;
  onClose: () => void;
  onSuccess: () => Promise<void> | void;
}

function getLocationQty(row: DashboardRow, location: StockLocation): number {
  if (location === "차량") return row.backupQty;
  return row.storageQty;
}

export default function StockMoveModal({
  open,
  row,
  onClose,
  onSuccess,
}: StockMoveModalProps) {
  const [from, setFrom] = useState<"창고" | "차량">("차량");
  const [to, setTo] = useState<"창고" | "차량">("창고");
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  const fromQty = useMemo(
    () => (row ? getLocationQty(row, from) : 0),
    [row, from]
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!row) return;

    const qty = Number(quantity);

    if (!Number.isInteger(qty) || qty <= 0) {
      alert("이동 수량은 1 이상의 정수로 입력해 주세요.");
      return;
    }

    if (from === to) {
      alert("출발지와 도착지가 같습니다. 위치를 다시 선택해 주세요.");
      return;
    }

    if (fromQty < qty) {
      alert(
        `${LOCATION_LABELS[from]} 재고가 부족합니다. (현재 ${fromQty}개)`
      );
      return;
    }

    setSubmitting(true);
    try {
      await transferStock({
        productId: row.id,
        from,
        to,
        quantity: qty,
      });
      await onSuccess();
      setFrom("차량");
      setTo("창고");
      setQuantity("1");
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "재고 이동에 실패했습니다.";
      alert(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="재고 이동"
      onClose={() => {
        if (!submitting) onClose();
      }}
    >
      {row && (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="space-y-4"
        >
          <div className="rounded-xl bg-slate-50 px-4 py-3">
            <p className="text-xs text-slate-500">{row.brand}</p>
            <p className="font-semibold text-slate-900">{row.name}</p>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              출발지
            </span>
            <select
              value={from}
              onChange={(event) =>
                setFrom(event.target.value as "창고" | "차량")
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            >
              {UI_STOCK_LOCATIONS.map((location) => (
                <option key={location} value={location}>
                  {LOCATION_LABELS[location]} (현재{" "}
                  {getLocationQty(row, location)}개)
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              도착지
            </span>
            <select
              value={to}
              onChange={(event) => setTo(event.target.value as "창고" | "차량")}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            >
              {UI_STOCK_LOCATIONS.map((location) => (
                <option key={location} value={location}>
                  {LOCATION_LABELS[location]} (현재{" "}
                  {getLocationQty(row, location)}개)
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              이동 수량
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            />
          </label>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {submitting ? "처리 중..." : "확인"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
