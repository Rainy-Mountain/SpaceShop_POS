import ExcelUpload from "@/components/ExcelUpload";
import LiquorTypeBulkUpdate from "@/components/LiquorTypeBulkUpdate";
import ManualProductForm from "@/components/ManualProductForm";

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
          엑셀로 대량 업로드하거나, 신규 품목을 직접 등록하세요.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-bold text-slate-900">
            엑셀 대량 업로드
          </h2>
          <p className="mt-1 mb-5 text-sm text-slate-500">
            제품·재고 시트가 포함된 엑셀 파일을 업로드합니다.
          </p>
          <ExcelUpload />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-bold text-slate-900">
            신규 품목 수동 등록
          </h2>
          <p className="mt-1 mb-5 text-sm text-slate-500">
            단일 제품을 바로 추가합니다. 브랜드 미지정으로 등록됩니다.
          </p>
          <ManualProductForm />
        </section>
      </div>

      <LiquorTypeBulkUpdate />
    </main>
  );
}
