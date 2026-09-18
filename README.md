# SpaceShop Inventory

행사용 재고 관리 웹앱 — 엑셀 드래그 앤 드롭 업로드.

## Setup

1. Node.js 설치 후 의존성 설치

```bash
npm install
```

2. `.env.local` 설정 (예시: `.env.local.example`)

```env
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

3. (선택) `supabase/schema.sql`을 Supabase SQL Editor에서 실행

4. 개발 서버 실행

```bash
npm run dev
```

## Excel columns

| 브랜드 | 제품명 | 구분 | 가격 | 백업재고 | 창고재고 | 진열재고 |
