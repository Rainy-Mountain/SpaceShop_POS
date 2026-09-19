import ExcelUpload from "@/components/ExcelUpload";
import LiquorTypeBulkUpdate from "@/components/LiquorTypeBulkUpdate";
import ManualProductForm from "@/components/ManualProductForm";
import BulkInventoryPasteEntry from "@/components/BulkInventoryPasteEntry";

const cardClass =
  "flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-8 shadow-sm";

const cardTitleClass = "text-lg font-bold text-gray-800";
const cardDescClass = "text-sm text-gray-500";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4.5rem)] w-full max-w-6xl flex-col px-4 py-10 sm:px-6">
      <div className="mb-8 text-center">
        <p className="text-sm font-medium tracking-wide text-sky-600">
          SpaceShop Inventory
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
          재고 등록
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          일괄 등록·엑셀 업로드·수동 등록을 한곳에서 관리하세요.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-stretch">
        {/* 왼쪽: 대량 / 일괄 작업 */}
        <div className="flex flex-col gap-6">
          <section className={cardClass}>
            <div>
              <h2 className={cardTitleClass}>
                스마트 일괄 등록 (텍스트 복붙)
              </h2>
              <p className={`mt-1.5 ${cardDescClass}`}>
                엑셀 데이터를 복사해 붙여넣어 여러 품목을 스마트하게 추가하고
                검토합니다.
              </p>
            </div>
            <div className="flex flex-1 flex-col items-center justify-center py-6">
              <BulkInventoryPasteEntry />
              <p className="mt-3 text-xs text-gray-400">
                Tab · 콤마 · | 구분 텍스트 지원
              </p>
            </div>
          </section>

          <section className={cardClass}>
            <div>
              <h2 className={cardTitleClass}>엑셀 대량 업로드</h2>
              <p className={`mt-1.5 ${cardDescClass}`}>
                제품·재고 시트가 포함된 엑셀 파일을 업로드합니다.
              </p>
            </div>
            <ExcelUpload />
          </section>

          <section className={cardClass}>
            <div>
              <h2 className={cardTitleClass}>주종 일괄 업데이트</h2>
              <p className={`mt-1.5 ${cardDescClass}`}>
                재고 수량은 그대로 두고, 상품의 주종(
                <code className="rounded bg-gray-100 px-1 text-[11px]">
                  liquor_type
                </code>
                )만 일괄 변경합니다.
              </p>
            </div>
            <LiquorTypeBulkUpdate />
          </section>
        </div>

        {/* 오른쪽: 수동 작업 */}
        <div className="flex flex-col">
          <section className={`${cardClass} h-full min-h-full flex-1 py-10`}>
            <div>
              <h2 className={cardTitleClass}>신규 품목 수동 등록</h2>
              <p className={`mt-1.5 ${cardDescClass}`}>
                단일 제품을 바로 추가합니다. 브랜드 미지정으로 등록됩니다.
              </p>
            </div>
            <div className="flex flex-1 flex-col justify-center pt-2">
              <ManualProductForm />
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
