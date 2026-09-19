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
        className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700"
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
