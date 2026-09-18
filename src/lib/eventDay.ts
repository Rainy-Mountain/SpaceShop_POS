import type { EventDay } from "@/types/dashboard";

export const EVENT_DAY_STORAGE_KEY = "currentDay";

export function isEventDay(value: unknown): value is EventDay {
  return value === 1 || value === 2 || value === 3;
}

export function readStoredEventDay(): EventDay {
  if (typeof window === "undefined") return 1;
  const raw = Number(window.localStorage.getItem(EVENT_DAY_STORAGE_KEY));
  return isEventDay(raw) ? raw : 1;
}

export function writeStoredEventDay(day: EventDay): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EVENT_DAY_STORAGE_KEY, String(day));
}
