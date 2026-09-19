import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "스마트 컨시어지 | SpaceShop",
  description: "현장 오더 현황 · 손님 안내 QR",
};

export default function StaffQrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
