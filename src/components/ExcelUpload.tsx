"use client";

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { parseExcelFile } from "@/lib/parseExcel";
import { uploadExcelRows } from "@/lib/uploadExcel";
import type {
  UploadLogItem,
  UploadProgress,
  UploadSummary,
} from "@/types/inventory";

const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

function isExcelFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return (
    ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext)) ||
    file.type.includes("sheet") ||
    file.type.includes("excel") ||
    file.type === "text/csv"
  );
}

export default function ExcelUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [logs, setLogs] = useState<UploadLogItem[]>([]);

  const handleProgress = useCallback((next: UploadProgress) => {
    setProgress({ ...next });

    if (next.status === "processing") return;

    setLogs((prev) => {
      const item: UploadLogItem = {
        key: `${next.current}-${next.productName}-${next.status}`,
        index: next.current,
        productName: next.productName,
        status: next.status,
        message: next.message,
      };
      return [item, ...prev].slice(0, 50);
    });
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setSummary(null);
      setShowSuccess(false);
      setProgress(null);
      setLogs([]);

      if (!isExcelFile(file)) {
        setError("엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.");
        return;
      }

      setFileName(file.name);
      setIsUploading(true);

      try {
        setProgress({
          current: 0,
          total: 0,
          productName: "엑셀 파싱 중",
          status: "processing",
        });

        const rows = await parseExcelFile(file);

        if (rows.length === 0) {
          throw new Error("업로드할 유효한 행이 없습니다.");
        }

        setProgress({
          current: 0,
          total: rows.length,
          productName: "업로드 준비 중",
          status: "processing",
        });

        // 파싱 완료 후 UI가 한 번 그려지도록 양보
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        const result = await uploadExcelRows(rows, handleProgress);
        setSummary(result);
        setShowSuccess(true);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "업로드 중 오류가 발생했습니다.";
        setError(message);
      } finally {
        setIsUploading(false);
        if (inputRef.current) {
          inputRef.current.value = "";
        }
      }
    },
    [handleProgress]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const onSelect = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div className="w-full">
      <div
        role="button"
        tabIndex={0}
        aria-label="엑셀 파일 업로드"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setIsDragging(false);
        }}
        onDrop={onDrop}
        onClick={() => {
          if (!isUploading) inputRef.current?.click();
        }}
        className={[
          "relative flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-10 text-center transition",
          isDragging
            ? "border-sky-500 bg-sky-50"
            : "border-slate-300 bg-white hover:border-sky-400 hover:bg-slate-50",
          isUploading ? "pointer-events-none opacity-70" : "",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={onSelect}
          disabled={isUploading}
        />

        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-sky-600">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-7 w-7"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
            />
          </svg>
        </div>
        <p className="text-lg font-semibold text-slate-800">
          엑셀 파일을 드래그 앤 드롭하거나 클릭해서 업로드하세요
        </p>
        <p className="mt-2 text-sm text-slate-500">지원 형식: .xlsx, .xls</p>
        <p className="mt-4 text-xs text-slate-400">
          제품: 손님 체크용 · 스컴할인* · 타사제품 (브랜드·제품명 필수)
          <br />
          재고: 시트명에 &apos;재고확인용&apos; 포함 시트만
        </p>
      </div>

      {(isUploading || progress) && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {isUploading ? "업로드 진행 중" : "업로드 현황"}
              </p>
              {fileName && (
                <p className="mt-1 text-xs text-slate-500">{fileName}</p>
              )}
            </div>
            <p className="shrink-0 text-sm font-medium text-sky-700">
              {progress ? `${progress.current}/${progress.total || "?"}` : "0/0"}
            </p>
          </div>

          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-200"
              style={{ width: `${percent}%` }}
            />
          </div>

          {progress && (
            <p className="mt-4 text-sm font-medium text-slate-700">
              {progress.status === "processing" && (
                <>
                  ✅ {progress.productName} 처리 중... ({progress.current}/
                  {progress.total || "?"})
                </>
              )}
              {progress.status === "success" && (
                <>
                  ✅ {progress.productName} 완료 ({progress.current}/
                  {progress.total})
                </>
              )}
              {progress.status === "error" && (
                <>
                  ⚠️ {progress.productName} 실패 ({progress.current}/
                  {progress.total})
                </>
              )}
            </p>
          )}

          {logs.length > 0 && (
            <ul className="mt-4 max-h-64 space-y-1.5 overflow-y-auto rounded-xl bg-slate-50 p-3 text-left text-sm">
              {logs.map((item) => (
                <li
                  key={item.key}
                  className={
                    item.status === "success"
                      ? "text-emerald-700"
                      : "text-rose-700"
                  }
                >
                  {item.status === "success" ? "✅" : "⚠️"} {item.productName}
                  <span className="text-slate-400">
                    {" "}
                    ({item.index}/{progress?.total ?? item.index})
                  </span>
                  {item.message ? ` — ${item.message}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showSuccess && summary && !isUploading && (
        <div
          role="status"
          className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-800"
        >
          <p className="font-semibold">업로드가 완료되었습니다.</p>
          <p className="mt-1 text-sm">
            전체 {summary.total}건 · 신규 {summary.inserted}건 · 업데이트{" "}
            {summary.updated}건 · 건너뜀 {summary.skipped}건
          </p>
          {summary.errors.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-amber-800">
              {summary.errors.slice(0, 5).map((item) => (
                <li key={item}>• {item}</li>
              ))}
              {summary.errors.length > 5 && (
                <li>• 외 {summary.errors.length - 5}건의 오류</li>
              )}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4 text-rose-800"
        >
          <p className="font-semibold">업로드 실패</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
