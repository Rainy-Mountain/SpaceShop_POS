import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "스마트 POS | SpaceShop",
  description: "매니저용 실시간 결제 대기열",
};

export default function AdminPosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
