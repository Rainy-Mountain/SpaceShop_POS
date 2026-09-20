"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LiquorRecognition = {
  name: string;
  description: string;
  abv: string;
  tasting_notes: string;
  recommend_reason: string;
  event_price: number | null;
};

const SCAN_INTERVAL_MS = 2000;
const MOBILE_QUERY = "(max-width: 768px)";
const CAMERA_ERROR_MESSAGE =
  "카메라 접근 권한을 허용해 주시거나, HTTPS 환경에서 접속해 주세요.";

function applyIosVideoFlags(video: HTMLVideoElement) {
  video.setAttribute("playsinline", "true");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("autoplay", "true");
  video.playsInline = true;
  video.muted = true;
  video.defaultMuted = true;
  video.autoplay = true;
}

async function getRearCameraStream() {
  const attempts: MediaStreamConstraints[] = [
    {
      audio: false,
      video: { facingMode: { exact: "environment" } },
    },
    {
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    },
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("카메라 스트림을 시작할 수 없습니다.");
}

function formatEventPrice(price: number | null) {
  if (price === null || !Number.isFinite(price)) return null;
  return `${Math.round(price).toLocaleString("ko-KR")}원`;
}

function isLiquorResult(value: unknown): value is LiquorRecognition {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.found === false) return false;
  const name =
    typeof record.matched_db_name === "string"
      ? record.matched_db_name
      : typeof record.name === "string"
        ? record.name
        : "";
  return name.trim().length > 0;
}

export default function SmartLensClient() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inFlightRef = useRef(false);
  const cancelledRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [liquor, setLiquor] = useState<LiquorRecognition | null>(null);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) video.srcObject = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      stopCamera();
      setCameraError(CAMERA_ERROR_MESSAGE);
      return;
    }

    try {
      const stream = await getRearCameraStream();
      if (cancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      applyIosVideoFlags(video);
      video.srcObject = stream;
      await video.play();
      if (cancelledRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      setCameraReady(true);
      setCameraError(null);
    } catch (error) {
      console.warn("[smart-lens] camera error", error);
      stopCamera();
      setCameraError(CAMERA_ERROR_MESSAGE);
    }
  }, [stopCamera]);

  useEffect(() => {
    if (!isMobile) {
      cancelledRef.current = true;
      stopCamera();
      return;
    }

    cancelledRef.current = false;
    void startCamera();
    return () => {
      cancelledRef.current = true;
      stopCamera();
    };
  }, [isMobile, startCamera, stopCamera]);

  const captureAndRecognize = useCallback(async () => {
    if (inFlightRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) {
      return;
    }

    const maxWidth = 720;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", 0.72);

    inFlightRef.current = true;
    setScanning(true);
    try {
      const response = await fetch("/api/recognize-liquor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        return;
      }
      if (payload === null || !isLiquorResult(payload)) {
        setLiquor(null);
        return;
      }
      const record = payload as LiquorRecognition & {
        matched_db_name?: string;
        found?: boolean;
      };
      setLiquor({
        name: record.matched_db_name || record.name,
        description: record.description ?? "",
        abv: record.abv ?? "",
        tasting_notes: record.tasting_notes ?? "",
        recommend_reason: record.recommend_reason ?? "",
        event_price:
          typeof record.event_price === "number" ? record.event_price : null,
      });
    } catch (error) {
      console.warn("[smart-lens] 인식 요청 실패", error);
    } finally {
      inFlightRef.current = false;
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (!isMobile || !cameraReady) return;
    const timer = window.setInterval(() => {
      void captureAndRecognize();
    }, SCAN_INTERVAL_MS);
    void captureAndRecognize();
    return () => window.clearInterval(timer);
  }, [isMobile, cameraReady, captureAndRecognize]);

  const sheetOpen = liquor !== null;
  const eventPriceLabel = formatEventPrice(liquor?.event_price ?? null);

  return (
    <>
      <style>{`
        @keyframes smart-lens-scan {
          0% { transform: translateY(-8%); opacity: 0; }
          12% { opacity: 0.9; }
          88% { opacity: 0.9; }
          100% { transform: translateY(108%); opacity: 0; }
        }
      `}</style>

      <div className="flex h-[100dvh] w-[100vw] items-center justify-center bg-zinc-950 px-8 text-center max-[768px]:hidden">
        <p className="max-w-sm text-base font-medium leading-relaxed text-white/80">
          모바일에서만 지원되는 기능입니다
        </p>
      </div>

      <div className="relative hidden h-[100dvh] w-[100vw] overflow-hidden bg-black max-[768px]:block">
        <video
          ref={(element) => {
            videoRef.current = element;
            if (element) applyIosVideoFlags(element);
          }}
          className="absolute inset-0 h-full w-full object-cover"
          autoPlay
          muted
          playsInline
          controls={false}
          disablePictureInPicture
          disableRemotePlayback
          webkit-playsinline="true"
        />
        <canvas ref={canvasRef} className="hidden" />

        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_42%,rgba(0,0,0,0.55)_100%)]" />

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div
            className={`relative h-52 w-52 transition-all duration-500 ${
              scanning ? "scale-105" : "scale-100"
            }`}
          >
            <span className={`absolute left-0 top-0 h-10 w-10 rounded-tl-md border-l-2 border-t-2 ${scanning ? "border-amber-300" : "border-white/70"}`} />
            <span className={`absolute right-0 top-0 h-10 w-10 rounded-tr-md border-r-2 border-t-2 ${scanning ? "border-amber-300" : "border-white/70"}`} />
            <span className={`absolute bottom-0 left-0 h-10 w-10 rounded-bl-md border-b-2 border-l-2 ${scanning ? "border-amber-300" : "border-white/70"}`} />
            <span className={`absolute bottom-0 right-0 h-10 w-10 rounded-br-md border-b-2 border-r-2 ${scanning ? "border-amber-300" : "border-white/70"}`} />
            {scanning && (
              <span
                className="absolute inset-x-3 top-0 h-0.5 bg-gradient-to-r from-transparent via-amber-200 to-transparent"
                style={{ animation: "smart-lens-scan 1.4s linear infinite" }}
              />
            )}
          </div>
          {scanning && (
            <p className="mt-6 text-sm font-medium tracking-[0.28em] text-amber-100/90">
              인식 중...
            </p>
          )}
        </div>

        {cameraError && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 px-8 text-center">
            <p className="max-w-xs text-sm leading-relaxed text-white/90">
              {CAMERA_ERROR_MESSAGE}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full bg-amber-300 px-5 py-2.5 text-sm font-semibold text-zinc-950"
            >
              새로고침
            </button>
          </div>
        )}

        <div className="absolute left-0 right-0 top-0 z-10 bg-gradient-to-b from-black/55 to-transparent px-5 pb-10 pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.32em] text-amber-200/80">
            Smart Lens
          </p>
          <h1 className="mt-1 text-lg font-semibold text-white">실시간 주류 스캔</h1>
        </div>

        <div
          className={`absolute inset-x-0 bottom-0 z-20 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] transition-transform duration-500 ease-out ${
            sheetOpen ? "translate-y-0" : "translate-y-[110%]"
          }`}
        >
          <div className="rounded-t-[28px] border border-white/15 bg-zinc-950/85 px-5 pb-6 pt-3 shadow-[0_-18px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/25" />
            {liquor && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium tracking-[0.22em] text-amber-200/80">
                      인식된 주류
                    </p>
                    <h2 className="mt-1 text-xl font-semibold leading-snug text-white">
                      {liquor.name}
                    </h2>
                  </div>
                  <div className="rounded-2xl bg-amber-300/15 px-3 py-2 text-right">
                    <p className="text-[10px] tracking-widest text-amber-100/70">
                      행사가격
                    </p>
                    <p className="text-base font-bold text-amber-200">
                      {eventPriceLabel ?? "미등록"}
                    </p>
                  </div>
                </div>

                {liquor.description && (
                  <p className="text-sm leading-relaxed text-white/80">
                    {liquor.description}
                  </p>
                )}

                <dl className="grid grid-cols-1 gap-3">
                  <InfoRow label="도수" value={liquor.abv} />
                  <InfoRow label="테이스팅 노트" value={liquor.tasting_notes} />
                  <InfoRow label="추천 이유" value={liquor.recommend_reason} />
                </dl>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <dt className="text-[11px] font-medium tracking-[0.18em] text-white/45">
        {label}
      </dt>
      <dd className="mt-1 text-sm leading-relaxed text-white/90">{value}</dd>
    </div>
  );
}
