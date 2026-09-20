"use client";

import dynamic from "next/dynamic";

const SmartLensClient = dynamic(() => import("./SmartLensClient"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[100dvh] w-[100vw] items-center justify-center bg-black text-sm text-white/70">
      스마트 렌즈 준비 중…
    </div>
  ),
});

export default function SmartLensPage() {
  return <SmartLensClient />;
}
