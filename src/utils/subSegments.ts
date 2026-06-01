export const SUB_SEGMENT_PREFIX = 'sub::';

export function makeSubSegmentKey(parent: string, child: string): string {
  return `${SUB_SEGMENT_PREFIX}${parent}::${child}`;
}

export function isSubSegmentKey(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(SUB_SEGMENT_PREFIX);
}

export function parseSubSegmentKey(value: string | null | undefined): { parent: string; child: string } | null {
  if (!isSubSegmentKey(value)) return null;
  const raw = value.slice(SUB_SEGMENT_PREFIX.length);
  const splitIndex = raw.indexOf('::');
  if (splitIndex < 0) return null;
  const parent = raw.slice(0, splitIndex);
  const child = raw.slice(splitIndex + 2);
  if (!parent || !child) return null;
  return { parent, child };
}

export function formatSegmentLabel(parent: string | null | undefined, child: string | null | undefined): string {
  const p = String(parent || '').trim();
  const c = String(child || '').trim();
  if (p && c) return `${p} / ${c}`;
  return p || c || '未分类';
}
