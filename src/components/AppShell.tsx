"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import AppNav from "@/components/AppNav";

/** iframe·손님용·스마트오더 경로 — 관리자 네비 숨김 */
const PUBLIC_PREFIXES = [
  "/public-menu",
  "/customer",
  "/queue",
  "/order",
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "";
  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (isPublic) {
    return <>{children}</>;
  }

  return (
    <>
      <AppNav />
      {children}
    </>
  );
}
