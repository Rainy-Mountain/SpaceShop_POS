"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEventDay } from "@/hooks/useEventDay";
import type { EventDay } from "@/types/dashboard";

const LINKS = [
  { href: "/", label: "엑셀 업로드" },
  { href: "/inventory", label: "재고 현황판" },
  { href: "/admin/pos", label: "스마트 POS" },
  { href: "/staff/qr", label: "손님 QR" },
  { href: "/soldout", label: "품절 안내" },
  { href: "/kiosk", label: "키오스크" },
  { href: "/sales-feed", label: "실시간 판매 기록" },
  { href: "/replenish", label: "물류 보충" },
  { href: "/report", label: "매출 보고서" },
] as const;

const EVENT_DAYS: EventDay[] = [1, 2, 3];

export default function AppNav() {
  const pathname = usePathname();
  const { eventDay, setEventDay } = useEventDay();
  const isReportPage = pathname.startsWith("/report");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMobileMenuOpen]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          {/* 상단 바: 모바일 = 로고 / 일차 뱃지 / 햄버거 */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-sky-600">
                SpaceShop
              </p>
              <p className="truncate text-sm font-bold text-slate-900 sm:text-base">
                행사 재고 관리
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!isReportPage && (
                <>
                  <span className="inline-flex items-center rounded-full bg-sky-600 px-2.5 py-1 text-[11px] font-bold text-white sm:text-xs">
                    현재: {eventDay}일차
                  </span>

                  {/* 데스크탑 일차 선택 */}
                  <label className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 shadow-sm md:flex">
                    <span className="text-[11px] font-medium text-slate-500">
                      일차
                    </span>
                    <select
                      value={eventDay}
                      onChange={(event) =>
                        setEventDay(Number(event.target.value) as EventDay)
                      }
                      className="rounded border-0 bg-transparent py-0.5 pr-4 text-sm font-semibold text-slate-900 outline-none"
                      aria-label="운영 일차 선택"
                    >
                      {EVENT_DAYS.map((day) => (
                        <option key={day} value={day}>
                          {day}일차
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              {/* 모바일 햄버거 */}
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(true)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm md:hidden"
                aria-label="메뉴 열기"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-6 w-6"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M3.75 5.25a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1-.75-.75Zm0 6.75a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1-.75-.75Zm0 6.75a.75.75 0 0 1 .75-.75h15a.75.75 0 0 1 0 1.5h-15a.75.75 0 0 1-.75-.75Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* 데스크탑/태블릿 가로 탭 */}
          <nav className="hidden max-w-full overflow-x-auto rounded-xl bg-slate-100 p-1 md:flex">
            {LINKS.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={[
                    "shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition sm:px-4",
                    active
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-800",
                  ].join(" ")}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* 모바일 메뉴 Backdrop */}
      {isMobileMenuOpen && (
        <button
          type="button"
          aria-label="메뉴 닫기"
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* 모바일 슬라이드 메뉴 */}
      <aside
        className={[
          "fixed top-0 right-0 z-50 flex h-full w-[min(100%,20rem)] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out md:hidden",
          isMobileMenuOpen
            ? "translate-x-0"
            : "pointer-events-none translate-x-full",
        ].join(" ")}
        aria-hidden={!isMobileMenuOpen}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-sky-600">
              SpaceShop
            </p>
            <p className="text-base font-bold text-slate-900">메뉴</p>
          </div>
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="메뉴 닫기"
          >
            ✕
          </button>
        </div>

        {!isReportPage && (
          <div className="border-b border-slate-100 px-4 py-4">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-slate-500">
                운영 일차
              </span>
              <select
                value={eventDay}
                onChange={(event) =>
                  setEventDay(Number(event.target.value) as EventDay)
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-base font-semibold text-slate-900 outline-none focus:border-sky-400 focus:bg-white"
                aria-label="운영 일차 선택"
              >
                {EVENT_DAYS.map((day) => (
                  <option key={day} value={day}>
                    {day}일차
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={[
                  "rounded-xl px-4 py-4 text-base font-semibold transition",
                  active
                    ? "bg-sky-600 text-white"
                    : "text-slate-800 hover:bg-slate-100",
                ].join(" ")}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
