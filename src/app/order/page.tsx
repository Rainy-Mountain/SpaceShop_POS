"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";

const CustomerOrderBoard = dynamic(
  () => import("@/components/CustomerOrderBoard"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
        주문 화면 불러오는 중…
      </div>
    ),
  }
);

export default function OrderPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
          주문 화면 불러오는 중…
        </div>
      }
    >
      <CustomerOrderBoard />
    </Suspense>
  );
}
