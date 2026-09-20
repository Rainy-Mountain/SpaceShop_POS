import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "스마트 렌즈 | SpaceShop",
  description: "실시간 주류 스캔",
};

export default function SmartLensLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
