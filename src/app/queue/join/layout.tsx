import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "스마트 오더 입장 | SpaceShop",
  description: "대기 순번 발급",
};

export default function QueueJoinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
