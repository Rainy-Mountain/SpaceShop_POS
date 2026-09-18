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
  readStoredEventDay,
  writeStoredEventDay,
} from "@/lib/eventDay";
import type { EventDay } from "@/types/dashboard";

type EventDayContextValue = {
  eventDay: EventDay;
  setEventDay: (day: EventDay) => void;
};

const EventDayContext = createContext<EventDayContextValue | null>(null);

export function EventDayProvider({ children }: { children: ReactNode }) {
  const [eventDay, setEventDayState] = useState<EventDay>(1);

  useEffect(() => {
    setEventDayState(readStoredEventDay());
  }, []);

  const setEventDay = useCallback((day: EventDay) => {
    writeStoredEventDay(day);
    setEventDayState(day);
  }, []);

  const value = useMemo(
    () => ({ eventDay, setEventDay }),
    [eventDay, setEventDay]
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
