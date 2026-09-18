/** 초성 퀵필터용 유틸 */

const HANGUL_CHO = [
  "ㄱ",
  "ㄲ",
  "ㄴ",
  "ㄷ",
  "ㄸ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅃ",
  "ㅅ",
  "ㅆ",
  "ㅇ",
  "ㅈ",
  "ㅉ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

const DOUBLE_TO_SINGLE: Record<string, string> = {
  ㄲ: "ㄱ",
  ㄸ: "ㄷ",
  ㅃ: "ㅂ",
  ㅆ: "ㅅ",
  ㅉ: "ㅈ",
};

export const KOREAN_INITIALS = [
  "ㄱ",
  "ㄴ",
  "ㄷ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅅ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

export const ALPHA_INITIALS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
] as const;

export const DIGIT_INITIALS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
] as const;

export const NUMBER_INITIAL = "숫자";

export type InitialFilter = string | null;

/** 문자열 첫 글자의 초성/알파벳/숫자 키 추출 (현황판용 — 숫자는 '숫자'로 묶음) */
export function getInitialKey(text: string): string {
  const first = text.trim().charAt(0);
  if (!first) return NUMBER_INITIAL;

  const code = first.charCodeAt(0);

  // 한글 음절
  if (code >= 0xac00 && code <= 0xd7a3) {
    const choIndex = Math.floor((code - 0xac00) / (21 * 28));
    const cho = HANGUL_CHO[choIndex] ?? NUMBER_INITIAL;
    return DOUBLE_TO_SINGLE[cho] ?? cho;
  }

  // 단독 자음
  if (first >= "ㄱ" && first <= "ㅎ") {
    return DOUBLE_TO_SINGLE[first] ?? first;
  }

  if (/[A-Za-z]/.test(first)) {
    return first.toUpperCase();
  }

  if (/[0-9]/.test(first)) {
    return NUMBER_INITIAL;
  }

  return NUMBER_INITIAL;
}

/** 키오스크용: 숫자는 0~9 개별 키로 반환 */
export function getBrandInitialKey(text: string): string {
  const first = text.trim().charAt(0);
  if (!first) return "";

  if (/[0-9]/.test(first)) return first;

  const key = getInitialKey(text);
  if (key === NUMBER_INITIAL) return "";
  return key;
}

export function matchesInitialFilter(
  brand: string,
  name: string,
  filter: string
): boolean {
  return getInitialKey(brand) === filter || getInitialKey(name) === filter;
}

/** 초성 버튼 표시 순서: ㄱ~ㅎ → A~Z → 0~9 */
export function sortInitialKeys(keys: Iterable<string>): string[] {
  const order = new Map<string, number>();
  KOREAN_INITIALS.forEach((k, i) => order.set(k, i));
  ALPHA_INITIALS.forEach((k, i) => order.set(k, 100 + i));
  DIGIT_INITIALS.forEach((k, i) => order.set(k, 200 + i));

  return Array.from(new Set(keys)).sort((a, b) => {
    const ai = order.get(a) ?? 999;
    const bi = order.get(b) ?? 999;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b, "ko");
  });
}
