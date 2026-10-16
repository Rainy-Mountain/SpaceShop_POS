type Page<T> = { data: T[] | null; error: { message: string } | null };

/** 호출자는 반드시 고유 ID까지 포함하는 일정한 정렬을 지정해야 한다. */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<T>>,
  pageSize = 500
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error("페이지 크기는 1 이상의 정수여야 합니다.");
  }
  const rows: T[] = [];
  for (let from = 0; ;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    if (page.length === 0) return rows;
    rows.push(...page);
    // 서버의 설정된 행 제한이 요청 크기보다 작아도 중간에서 끊지 않는다.
    from += page.length;
  }
}

/** 긴 .in() URL과 API 행 제한을 피한다. */
export async function fetchIdBatches<T>(
  ids: string[],
  fetchBatch: (ids: string[]) => PromiseLike<Page<T>>
): Promise<T[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const rows: T[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await fetchBatch(unique.slice(i, i + 100));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}
