"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BulkInventoryPasteModal from "@/components/BulkInventoryPasteModal";

export default function BulkInventoryPasteEntry() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-w-[12rem] items-center justify-center rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 hover:shadow-md"
      >
        일괄 재고 추가
      </button>
      <BulkInventoryPasteModal
        open={open}
        onClose={() => setOpen(false)}
        onApplied={() => {
          router.refresh();
        }}
      />
    </>
  );
}
