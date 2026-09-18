"use client";

import dynamic from "next/dynamic";

/**
 * 아임웹 iframe 삽입용 고객 열람 페이지.
 * ssr: false → Vercel 빌드/SSR 시 Supabase를 호출하지 않음.
 */
const CustomerMenuBoard = dynamic(
  () => import("@/components/CustomerMenuBoard"),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        재고 현황 불러오는 중…
      </div>
    ),
  }
);

export default function PublicMenuPage() {
  return <CustomerMenuBoard />;
}
