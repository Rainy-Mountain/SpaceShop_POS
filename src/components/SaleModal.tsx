"use client";

import { useMemo, useState, type FormEvent } from "react";
import Modal from "@/components/Modal";
import { registerSale } from "@/lib/inventoryActions";
import {
  LOCATION_LABELS,
  UI_STOCK_LOCATIONS,
  type DashboardRow,
  type EventDay,
  type StockLocation,
} from "@/types/dashboard";

interface SaleModalProps {
  open: boolean;
  row: DashboardRow | null;
  eventDay: EventDay;
  onClose: () => void;
  onSuccess: (result: {
    productName: string;
    quantity: number;
  }) => Promise<void> | void;
}

function getLocationQty(row: DashboardRow, location: StockLocation): number {
  if (location === "차량") return row.backupQty;
  return row.storageQty;
}

function formatPrice(value: number): string {
  return new Intl.NumberFormat("ko-KR").format(value);
}

export default function SaleModal({
  open,
  row,
  eventDay,
  onClose,
  onSuccess,
}: SaleModalProps) {
  const [soldFrom, setSoldFrom] = useState<"창고" | "차량">("창고");
  const [quantity, setQuantity] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  const qtyNumber = Number(quantity);
  const totalPrice = useMemo(() => {
    if (!row || !Number.isFinite(qtyNumber) || qtyNumber <= 0) return 0;
    return row.price * qtyNumber;
  }, [row, qtyNumber]);

  const availableQty = row ? getLocationQty(row, soldFrom) : 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!row) return;

    const qty = Number(quantity);

    if (!Number.isInteger(qty) || qty <= 0) {
      alert("판매 수량은 1 이상의 정수로 입력해 주세요.");
      return;
    }

    if (availableQty < qty) {
      alert(
        `${LOCATION_LABELS[soldFrom]} 재고가 부족합니다. (현재 ${availableQty}개)`
      );
      return;
    }

    setSubmitting(true);
    try {
      await registerSale({
        productId: row.id,
        dayNumber: eventDay,
        soldFrom,
        quantity: qty,
        unitPrice: row.price,
      });
      await onSuccess({
        productName: row.name,
        quantity: qty,
      });
      setSoldFrom("창고");
      setQuantity("1");
      onClose();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "판매 등록에 실패했습니다.";
      alert(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="판매 등록"
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
            <p className="mt-1 text-sm text-slate-600">
              단가 {formatPrice(row.price)}원
            </p>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              판매 일자
            </span>
            <input
              type="text"
              value={`${eventDay}일차`}
              readOnly
              className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-700"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              차감 위치
            </span>
            <select
              value={soldFrom}
              onChange={(event) =>
                setSoldFrom(event.target.value as "창고" | "차량")
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
              판매 수량
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

          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-700">총 결제 금액</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-800">
              {formatPrice(totalPrice)}원
            </p>
          </div>

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
              className="flex-1 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {submitting ? "처리 중..." : "결제 및 판매 완료"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
