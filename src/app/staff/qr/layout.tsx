import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "손님 안내용 QR | SpaceShop",
  description: "스마트 오더 대기열 등록 QR 코드",
};

export default function StaffQrLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
