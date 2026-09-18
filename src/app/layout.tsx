import type { Metadata } from "next";
import AppShell from "@/components/AppShell";
import { EventDayProvider } from "@/components/EventDayProvider";
import "./globals.css";

/** 전 라우트 동적 렌더링 — 빌드 시 SSG/Supabase 연결 방지 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "SpaceShop 재고 관리",
  description: "행사용 재고 관리 웹앱",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 antialiased">
        <EventDayProvider>
          <AppShell>{children}</AppShell>
        </EventDayProvider>
      </body>
    </html>
  );
}
