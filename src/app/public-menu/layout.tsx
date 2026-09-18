import type { Metadata } from "next";

/** 빌드 시 SSG로 Supabase에 붙지 않도록 동적 렌더링 강제 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "재고 현황 | SpaceShop",
  description: "고객 열람용 실시간 재고 현황",
};

export default function PublicMenuLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
