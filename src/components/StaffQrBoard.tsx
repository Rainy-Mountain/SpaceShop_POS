"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * 직원용 — 손님 안내용 QR 코드 노출
 * QR data = 현재 도메인의 /queue/join
 */
export default function StaffQrBoard() {
  const [joinUrl, setJoinUrl] = useState("");

  useEffect(() => {
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
      window.location.origin;
    setJoinUrl(`${origin}/queue/join`);
  }, []);

  const qrSrc = useMemo(() => {
    if (!joinUrl) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(joinUrl)}`;
  }, [joinUrl]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900 sm:text-3xl">
          손님 안내용 QR 코드
        </h1>
        <p className="mt-2 text-sm text-gray-500 sm:text-base">
          스마트폰 카메라로 스캔하여 대기열에 등록해주세요.
        </p>

        <div className="mx-auto mt-8 flex aspect-square w-full max-w-[400px] items-center justify-center rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          {qrSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrSrc}
              alt="대기열 등록 QR 코드"
              width={400}
              height={400}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="h-48 w-48 animate-pulse rounded-xl bg-gray-100" />
          )}
        </div>

        {joinUrl && (
          <p className="mt-4 break-all text-xs text-gray-400">{joinUrl}</p>
        )}
      </div>
    </main>
  );
}
