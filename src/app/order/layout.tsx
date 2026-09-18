import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "스마트 오더 | SpaceShop",
  description: "고객용 장바구니 및 주문서",
};

export default function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
