import type { EventDay } from "@/types/dashboard";

export const EVENT_DAY_STORAGE_KEY = "currentDay";

/** 행사 1일차 날짜 (YYYY-MM-DD). 미설정 시 캘린더 추론 생략 */
export const EVENT_START_DATE_ENV = "NEXT_PUBLIC_EVENT_START_DATE";

export function isEventDay(value: unknown): value is EventDay {
  return value === 1 || value === 2 || value === 3;
}

/** 오늘 날짜 기준 행사 일차 (1~3) */
export function inferEventDayFromCalendar(now = new Date()): EventDay {
  const startRaw =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_EVENT_START_DATE
      : undefined;
  if (!startRaw || !/^\d{4}-\d{2}-\d{2}$/.test(startRaw)) {
    return 1;
  }

  const start = new Date(`${startRaw}T00:00:00`);
  if (Number.isNaN(start.getTime())) return 1;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate()
  );
  const diff = Math.floor(
    (today.getTime() - startDay.getTime()) / (24 * 60 * 60 * 1000)
  );
  if (diff <= 0) return 1;
  if (diff >= 2) return 3;
  return (diff + 1) as EventDay;
}

export function readStoredEventDay(): EventDay {
  if (typeof window === "undefined") return 1;
  const raw = Number(window.localStorage.getItem(EVENT_DAY_STORAGE_KEY));
  if (isEventDay(raw)) return raw;
  return inferEventDayFromCalendar();
}

export function writeStoredEventDay(day: EventDay): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EVENT_DAY_STORAGE_KEY, String(day));
}
