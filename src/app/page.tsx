import ExcelUpload from "@/components/ExcelUpload";
import LiquorTypeBulkUpdate from "@/components/LiquorTypeBulkUpdate";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-4.5rem)] w-full max-w-3xl flex-col px-4 py-10 sm:px-6">
      <div className="mb-8 text-center">
        <p className="text-sm font-medium tracking-wide text-sky-600">
          SpaceShop Inventory
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
          엑셀 재고 업로드
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          엑셀 파일을 올리면 제품과 재고 정보가 Supabase에 반영됩니다.
        </p>
      </div>

      <ExcelUpload />
      <LiquorTypeBulkUpdate />
    </main>
  );
}

