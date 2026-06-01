export type SegmentDepth = 1 | 2 | 3;

export const SUB_SEGMENT_PREFIX = 'sub::';

export function makeLevel2Key(level1: string, level2: string): string {
  return `${SUB_SEGMENT_PREFIX}${level1}::${level2}`;
}

/** @deprecated 使用 makeLevel2Key */
export const makeSubSegmentKey = makeLevel2Key;

export function makeLevel3Key(level1: string, level2: string, level3: string): string {
  return `${SUB_SEGMENT_PREFIX}${level1}::${level2}::${level3}`;
}

export function isSubSegmentKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SUB_SEGMENT_PREFIX);
}

export function parseSegmentPathKey(value: string | null | undefined): {
  level1: string;
  level2?: string;
  level3?: string;
  depth: 1 | 2 | 3;
} | null {
  if (!isSubSegmentKey(value)) return null;
  const parts = value!.slice(SUB_SEGMENT_PREFIX.length).split('::').filter(Boolean);
  if (parts.length === 2) {
    return { level1: parts[0], level2: parts[1], depth: 2 };
  }
  if (parts.length === 3) {
    return { level1: parts[0], level2: parts[1], level3: parts[2], depth: 3 };
  }
  return null;
}

/** 仅解析 2 层路径（兼容旧调用） */
export function parseSubSegmentKey(value: string | null | undefined): { parent: string; child: string } | null {
  const parsed = parseSegmentPathKey(value);
  if (!parsed || parsed.depth !== 2 || !parsed.level2) return null;
  return { parent: parsed.level1, child: parsed.level2 };
}

export function formatSegmentLabel(
  level1?: string | null,
  level2?: string | null,
  level3?: string | null
): string {
  const parts = [level1, level2, level3].map((s) => String(s || '').trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '未分类';
}

/** 层级 3 名称列表的父键：层级1::层级2 */
export function makeLevel2ParentKey(level1: string, level2: string): string {
  return `${level1}::${level2}`;
}

export function parseLevel2ParentKey(key: string): { level1: string; level2: string } | null {
  const idx = key.indexOf('::');
  if (idx < 0) return null;
  const level1 = key.slice(0, idx);
  const level2 = key.slice(idx + 2);
  if (!level1 || !level2) return null;
  return { level1, level2 };
}

export function inferSegmentDepth(
  segmentChildren: Record<string, string[]>,
  asinToSubSegment: Record<string, string>,
  segmentLevel3Children: Record<string, string[]> = {},
  asinToLevel3Segment: Record<string, string> = {}
): SegmentDepth {
  const hasL3Children = Object.values(segmentLevel3Children).some((arr) => (arr?.length ?? 0) > 0);
  const hasL3Tags = Object.keys(asinToLevel3Segment).length > 0;
  if (hasL3Children || hasL3Tags) return 3;

  const hasL2Children = Object.values(segmentChildren).some((arr) => (arr?.length ?? 0) > 0);
  const hasL2Tags = Object.keys(asinToSubSegment).length > 0;
  if (hasL2Children || hasL2Tags) return 2;

  return 1;
}

export function productMatchesSegmentFilter(
  asin: string,
  filterKey: string,
  asinToSegment: Record<string, string>,
  asinToSubSegment: Record<string, string>,
  asinToLevel3Segment: Record<string, string>
): boolean {
  const path = parseSegmentPathKey(filterKey);
  if (path) {
    if (asinToSegment[asin] !== path.level1) return false;
    if (path.depth >= 2 && asinToSubSegment[asin] !== path.level2) return false;
    if (path.depth === 3 && asinToLevel3Segment[asin] !== path.level3) return false;
    return true;
  }
  return asinToSegment[asin] === filterKey;
}

/** 降级细分层级时，将当前筛选 key 收束到仍有效的层级 */
export function coerceSegmentFilterKey(selected: string, depth: SegmentDepth): string {
  if (selected === 'all') return selected;
  const path = parseSegmentPathKey(selected);
  if (!path) {
    return selected;
  }
  if (depth === 1) return path.level1;
  if (depth === 2 && path.depth === 3 && path.level2) {
    return makeLevel2Key(path.level1, path.level2);
  }
  return selected;
}

export function isFilterKeyValidForDepth(filterKey: string, depth: SegmentDepth): boolean {
  if (filterKey === 'all') return true;
  const path = parseSegmentPathKey(filterKey);
  if (!path) return depth >= 1;
  if (path.depth === 2) return depth >= 2;
  if (path.depth === 3) return depth >= 3;
  return true;
}
