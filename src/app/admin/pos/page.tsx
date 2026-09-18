"use client";

import dynamic from "next/dynamic";

const AdminPosBoard = dynamic(() => import("@/components/AdminPosBoard"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-gray-500">
      POS 불러오는 중…
    </div>
  ),
});

export default function AdminPosPage() {
  return <AdminPosBoard />;
}
