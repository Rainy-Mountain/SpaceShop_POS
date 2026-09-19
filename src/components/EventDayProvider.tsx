"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  inferEventDayFromCalendar,
  isEventDay,
  readStoredEventDay,
  writeStoredEventDay,
  EVENT_DAY_STORAGE_KEY,
} from "@/lib/eventDay";
import { supabase } from "@/lib/supabase";
import type { EventDay } from "@/types/dashboard";

type EventDayContextValue = {
  eventDay: EventDay;
  setEventDay: (day: EventDay) => void;
  /** localStorage/최신 판매일 반영 완료 여부 */
  eventDayReady: boolean;
};

const EventDayContext = createContext<EventDayContextValue | null>(null);

async function fetchLatestSaleEventDay(): Promise<EventDay | null> {
  const { data, error } = await supabase
    .from("sales_logs")
    .select("day_number")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const day = Number(data.day_number);
  return isEventDay(day) ? day : null;
}

export function EventDayProvider({ children }: { children: ReactNode }) {
  // SSR/첫 페인트: localStorage 동기 읽기로 1일차 깜빡임 방지
  const [eventDay, setEventDayState] = useState<EventDay>(() =>
    typeof window !== "undefined" ? readStoredEventDay() : 1
  );
  const [eventDayReady, setEventDayReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const storedRaw = window.localStorage.getItem(EVENT_DAY_STORAGE_KEY);
      if (storedRaw != null && isEventDay(Number(storedRaw))) {
        const stored = Number(storedRaw) as EventDay;
        if (!cancelled) {
          setEventDayState(stored);
          setEventDayReady(true);
        }
        return;
      }

      // 저장된 값 없음 → 최근 결제 일차 또는 오늘 날짜 기준
      const fromSales = await fetchLatestSaleEventDay();
      const next = fromSales ?? inferEventDayFromCalendar();
      if (!cancelled) {
        writeStoredEventDay(next);
        setEventDayState(next);
        setEventDayReady(true);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  const setEventDay = useCallback((day: EventDay) => {
    writeStoredEventDay(day);
    setEventDayState(day);
  }, []);

  const value = useMemo(
    () => ({ eventDay, setEventDay, eventDayReady }),
    [eventDay, setEventDay, eventDayReady]
  );

  return (
    <EventDayContext.Provider value={value}>{children}</EventDayContext.Provider>
  );
}

export function useEventDay(): EventDayContextValue {
  const ctx = useContext(EventDayContext);
  if (!ctx) {
    throw new Error("useEventDay must be used within EventDayProvider");
  }
  return ctx;
}
