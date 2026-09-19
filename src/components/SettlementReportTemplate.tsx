"use client";

import { forwardRef, type CSSProperties } from "react";
import type { SettlementReportData } from "@/lib/buildSettlementReport";

function formatCurrency(value: number): string {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString("ko-KR");
}

type Props = {
  data: SettlementReportData | null;
};

const EMPTY: SettlementReportData = {
  scope: "today",
  title: "행사 정산 리포트",
  generatedAtLabel: "-",
  periodLabel: "-",
  totalRevenue: 0,
  paymentCount: 0,
  totalQuantity: 0,
  bestsellers: [],
  details: [],
};

/** html2canvas 호환 — Tailwind oklch 금지, HEX만 사용 */
const rootStyle: CSSProperties = {
  width: "794px",
  minHeight: "1123px",
  height: "auto",
  boxSizing: "border-box",
  backgroundColor: "#ffffff",
  color: "#111827",
  fontFamily:
    '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif',
  lineHeight: 1.5,
};

const textBase: CSSProperties = {
  lineHeight: 1.5,
  paddingTop: "4px",
  paddingBottom: "4px",
};

const SettlementReportTemplate = forwardRef<HTMLDivElement, Props>(
  function SettlementReportTemplate({ data }, ref) {
    const report = data ?? EMPTY;

    return (
      <div ref={ref} className="settlement-pdf-root" style={rootStyle}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "32px 40px 40px",
            boxSizing: "border-box",
            backgroundColor: "#ffffff",
            color: "#111827",
            lineHeight: 1.5,
          }}
        >
          <header
            style={{
              marginBottom: "20px",
              paddingBottom: "12px",
              borderBottom: "2px solid #111827",
            }}
          >
            <p
              style={{
                ...textBase,
                margin: 0,
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.12em",
                color: "#6b7280",
              }}
            >
              SPACESHOP · SMART ORDER
            </p>
            <h1
              style={{
                ...textBase,
                margin: "4px 0 0",
                fontSize: "26px",
                fontWeight: 800,
                color: "#111827",
              }}
            >
              {report.title}
            </h1>
            <div
              style={{
                ...textBase,
                marginTop: "4px",
                display: "flex",
                justifyContent: "space-between",
                fontSize: "12px",
                color: "#4b5563",
              }}
            >
              <span style={textBase}>집계 기간: {report.periodLabel}</span>
              <span style={textBase}>생성 일시: {report.generatedAtLabel}</span>
            </div>
          </header>

          <section
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "12px",
              marginBottom: "24px",
            }}
          >
            <div
              style={{
                borderRadius: "12px",
                border: "1px solid #bae6fd",
                backgroundColor: "#f0f9ff",
                padding: "14px 16px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  ...textBase,
                  margin: 0,
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#0369a1",
                }}
              >
                총 매출액
              </p>
              <p
                style={{
                  ...textBase,
                  margin: "6px 0 0",
                  fontSize: "26px",
                  fontWeight: 900,
                  color: "#0c4a6e",
                }}
              >
                {formatCurrency(report.totalRevenue)}
              </p>
            </div>
            <div
              style={{
                borderRadius: "12px",
                border: "1px solid #a7f3d0",
                backgroundColor: "#ecfdf5",
                padding: "14px 16px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  ...textBase,
                  margin: 0,
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#047857",
                }}
              >
                총 판매 수량
              </p>
              <p
                style={{
                  ...textBase,
                  margin: "6px 0 0",
                  fontSize: "26px",
                  fontWeight: 900,
                  color: "#064e3b",
                }}
              >
                {formatNumber(report.totalQuantity)}
                <span
                  style={{
                    marginLeft: "4px",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#047857",
                    lineHeight: 1.5,
                  }}
                >
                  병
                </span>
              </p>
            </div>
            <div
              style={{
                borderRadius: "12px",
                border: "1px solid #ddd6fe",
                backgroundColor: "#f5f3ff",
                padding: "14px 16px",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  ...textBase,
                  margin: 0,
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#6d28d9",
                }}
              >
                총 결제 건수
              </p>
              <p
                style={{
                  ...textBase,
                  margin: "6px 0 0",
                  fontSize: "26px",
                  fontWeight: 900,
                  color: "#4c1d95",
                }}
              >
                {formatNumber(report.paymentCount)}
                <span
                  style={{
                    marginLeft: "4px",
                    fontSize: "14px",
                    fontWeight: 700,
                    color: "#6d28d9",
                    lineHeight: 1.5,
                  }}
                >
                  건
                </span>
              </p>
            </div>
          </section>

          <section>
            <h2
              style={{
                ...textBase,
                margin: "0 0 10px",
                fontSize: "14px",
                fontWeight: 700,
                color: "#111827",
              }}
            >
              전체 판매 상세
            </h2>
            {report.details.length === 0 ? (
              <p
                style={{
                  ...textBase,
                  margin: 0,
                  fontSize: "12px",
                  color: "#6b7280",
                }}
              >
                판매된 품목이 없습니다.
              </p>
            ) : (
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "10.5px",
                  lineHeight: 1.4,
                  color: "#111827",
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        ...textBase,
                        textAlign: "left",
                        fontWeight: 700,
                        borderBottom: "2px solid #111827",
                        paddingTop: "6px",
                        paddingBottom: "8px",
                        color: "#111827",
                        width: "28%",
                      }}
                    >
                      제품명
                    </th>
                    <th
                      style={{
                        ...textBase,
                        textAlign: "center",
                        fontWeight: 700,
                        borderBottom: "2px solid #111827",
                        paddingTop: "4px",
                        paddingBottom: "6px",
                        width: "9%",
                        color: "#111827",
                      }}
                    >
                      1일차
                    </th>
                    <th
                      style={{
                        ...textBase,
                        textAlign: "center",
                        fontWeight: 700,
                        borderBottom: "2px solid #111827",
                        paddingTop: "4px",
                        paddingBottom: "6px",
                        width: "9%",
                        color: "#111827",
                      }}
                    >
                      2일차
                    </th>
                    <th
                      style={{
                        ...textBase,
                        textAlign: "center",
                        fontWeight: 700,
                        borderBottom: "2px solid #111827",
                        paddingTop: "4px",
                        paddingBottom: "6px",
                        width: "9%",
                        color: "#111827",
                      }}
                    >
                      3일차
                    </th>
                    <th
                      style={{
                        ...textBase,
                        textAlign: "center",
                        fontWeight: 700,
                        borderBottom: "2px solid #111827",
                        paddingTop: "4px",
                        paddingBottom: "6px",
                        width: "12%",
                        color: "#111827",
                      }}
                    >
                      총 판매량
                    </th>
                    <th
                      style={{
                        ...textBase,
                        textAlign: "right",
                        fontWeight: 700,
                        borderBottom: "2px solid #111827",
                        paddingTop: "4px",
                        paddingBottom: "6px",
                        width: "22%",
                        color: "#111827",
                      }}
                    >
                      합계 금액
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.details.map((item) => (
                    <tr key={item.productId}>
                      <td
                        style={{
                          ...textBase,
                          textAlign: "left",
                          borderBottom: "1px solid #e5e7eb",
                          paddingTop: "8px",
                          paddingBottom: "8px",
                          color: "#111827",
                          fontWeight: 500,
                        }}
                      >
                        {item.productName}
                      </td>
                      <td
                        style={{
                          ...textBase,
                          textAlign: "center",
                          borderBottom: "1px solid #e5e7eb",
                          paddingTop: "8px",
                          paddingBottom: "8px",
                          color: "#374151",
                          fontWeight: 600,
                        }}
                      >
                        {item.day1Sales > 0 ? formatNumber(item.day1Sales) : "—"}
                      </td>
                      <td
                        style={{
                          ...textBase,
                          textAlign: "center",
                          borderBottom: "1px solid #e5e7eb",
                          paddingTop: "8px",
                          paddingBottom: "8px",
                          color: "#374151",
                          fontWeight: 600,
                        }}
                      >
                        {item.day2Sales > 0 ? formatNumber(item.day2Sales) : "—"}
                      </td>
                      <td
                        style={{
                          ...textBase,
                          textAlign: "center",
                          borderBottom: "1px solid #e5e7eb",
                          paddingTop: "8px",
                          paddingBottom: "8px",
                          color: "#374151",
                          fontWeight: 600,
                        }}
                      >
                        {item.day3Sales > 0 ? formatNumber(item.day3Sales) : "—"}
                      </td>
                      <td
                        style={{
                          ...textBase,
                          textAlign: "center",
                          borderBottom: "1px solid #e5e7eb",
                          paddingTop: "8px",
                          paddingBottom: "8px",
                          color: "#047857",
                          fontWeight: 700,
                        }}
                      >
                        {formatNumber(item.quantity)}
                      </td>
                      <td
                        style={{
                          ...textBase,
                          textAlign: "right",
                          borderBottom: "1px solid #e5e7eb",
                          paddingTop: "8px",
                          paddingBottom: "8px",
                          color: "#047857",
                          fontWeight: 700,
                        }}
                      >
                        {formatCurrency(item.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {report.details.length > 0 ? (
              <p
                style={{
                  ...textBase,
                  marginTop: "8px",
                  marginBottom: 0,
                  fontSize: "9px",
                  color: "#9ca3af",
                }}
              >
                ※ 상위 10개 품목만 표시됩니다.
              </p>
            ) : null}
          </section>

          <footer
            style={{
              ...textBase,
              marginTop: "20px",
              paddingTop: "10px",
              borderTop: "1px solid #e5e7eb",
              fontSize: "9px",
              color: "#9ca3af",
              textAlign: "right",
            }}
          >
            SpaceShop 스마트 오더 · 자동 생성 리포트
          </footer>
        </div>
      </div>
    );
  }
);

export default SettlementReportTemplate;

/** html2canvas + jsPDF — 내용이 길면 A4 1장에 맞춰 축소 */
export async function downloadSettlementPdf(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    width: 794,
    windowWidth: 794,
    onclone: (clonedDoc) => {
      clonedDoc
        .querySelectorAll('link[rel="stylesheet"], style')
        .forEach((node) => node.remove());

      const root = clonedDoc.querySelector(
        ".settlement-pdf-root"
      ) as HTMLElement | null;
      if (root) {
        root.style.backgroundColor = "#ffffff";
        root.style.color = "#111827";
        root.style.lineHeight = "1.5";
        root.style.height = "auto";
        root.style.minHeight = "1123px";
        root.style.overflow = "visible";
      }
    },
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const maxW = pageWidth - margin * 2;
  const maxH = pageHeight - margin * 2;

  const imgW = canvas.width;
  const imgH = canvas.height;
  const ratio = Math.min(maxW / imgW, maxH / imgH);
  const renderW = imgW * ratio;
  const renderH = imgH * ratio;
  const offsetX = (pageWidth - renderW) / 2;
  const offsetY = (pageHeight - renderH) / 2;

  pdf.addImage(imgData, "PNG", offsetX, offsetY, renderW, renderH);
  pdf.save(filename);
}
