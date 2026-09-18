"use client";

import dynamic from "next/dynamic";

const StaffQrBoard = dynamic(() => import("@/components/StaffQrBoard"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
      QR 코드 불러오는 중…
    </div>
  ),
});

export default function StaffQrPage() {
  return <StaffQrBoard />;
}
