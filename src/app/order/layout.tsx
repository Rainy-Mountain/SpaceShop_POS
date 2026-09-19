import type { Metadata, Viewport } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "스마트 오더 | SpaceShop",
  description: "고객용 장바구니 및 주문서",
};

/** iOS Safari 입력 포커스 시 자동 확대 완화 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function OrderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
