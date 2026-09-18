"use client";

import dynamic from "next/dynamic";

const QueueJoinBoard = dynamic(() => import("@/components/QueueJoinBoard"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500">
      입장 화면 불러오는 중…
    </div>
  ),
});

export default function QueueJoinPage() {
  return <QueueJoinBoard />;
}
