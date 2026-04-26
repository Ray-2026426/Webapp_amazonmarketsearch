/** 将筛选框中的多词拆成列表（逗号、中文逗号、分号、竖线、换行） */
export function parseFilterTerms(raw: string): string[] {
  return raw
    .split(/[,，;；|\n\r]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function productSearchHaystack(p: { asin: string; title: string; brand: string }): string {
  return `${p.asin} ${p.title} ${p.brand}`.toLowerCase();
}

/** 包含条件：无词则视为不过滤（全通过到下一步） */
export function matchesIncludeTerms(
  haystack: string,
  terms: string[],
  mode: 'or' | 'and'
): boolean {
  if (terms.length === 0) return true;
  return mode === 'or'
    ? terms.some((t) => haystack.includes(t))
    : terms.every((t) => haystack.includes(t));
}

/** 是否应被排除：无词则不排除 */
export function matchesExcludeRule(
  haystack: string,
  terms: string[],
  mode: 'or' | 'and'
): boolean {
  if (terms.length === 0) return false;
  return mode === 'or'
    ? terms.some((t) => haystack.includes(t))
    : terms.every((t) => haystack.includes(t));
}
