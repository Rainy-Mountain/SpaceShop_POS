"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

export type ToastTone = "success" | "danger";

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
  exiting: boolean;
}

const recentToastFingerprints = new Map<string, number>();

/** useEffect([]) 안에서도 안전하게 쓸 수 있는 함수형 토스트 append */
export function appendToast(
  setToasts: Dispatch<SetStateAction<ToastItem[]>>,
  message: string,
  tone: ToastTone = "success"
) {
  const fingerprint = `${tone}:${message}`;
  const now = Date.now();
  const last = recentToastFingerprints.get(fingerprint) ?? 0;
  if (now - last < 2500) return;
  recentToastFingerprints.set(fingerprint, now);

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  setToasts((prev) => [...prev, { id, message, tone, exiting: false }]);

  window.setTimeout(() => {
    setToasts((prev) =>
      prev.map((toast) =>
        toast.id === id ? { ...toast, exiting: true } : toast
      )
    );

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 500);
  }, 15000);
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const pushToast = useCallback((message: string, tone: ToastTone = "success") => {
    appendToast(setToasts, message, tone);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((toast) =>
        toast.id === id ? { ...toast, exiting: true } : toast
      )
    );

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 500);
  }, []);

  return { toasts, setToasts, pushToast, dismissToast };
}

interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export default function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-[60] flex w-[min(100vw-2rem,22rem)] flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions"
    >
      {toasts.map((toast) => {
        const isDanger = toast.tone === "danger";
        return (
          <div
            key={toast.id}
            className={[
              "pointer-events-auto flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-white shadow-lg backdrop-blur-sm transition-opacity duration-500",
              isDanger
                ? "border-red-400/20 bg-red-600/90"
                : "border-white/10 bg-emerald-800/80",
              toast.exiting ? "opacity-0" : "opacity-100",
            ].join(" ")}
            role="status"
          >
            <p className="text-sm font-semibold leading-snug">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className={[
                "shrink-0 rounded-md px-1.5 py-0.5 text-sm transition hover:bg-white/10 hover:text-white",
                isDanger ? "text-red-50/80" : "text-emerald-50/80",
              ].join(" ")}
              aria-label="알림 닫기"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
