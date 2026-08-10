/** 与 App 里的 activeView 对齐 */
export type AnnotationView = 'market' | 'competitors' | 'insights' | 'keywords' | 'profit';

/** 锚点批注结构：在某个锚点区域内按相对坐标记录 */
export interface AnchorAnnotation {
  id: string;
  view: AnnotationView;
  anchorId: string;
  u: number;
  v: number;
  text: string;
  createdAt: string;
}

/** 拖动批注时用于命中穿透 */
export const ANNOTATION_PIN_PASS_THROUGH_CLASS = 'annotation-pin-pass-through';

/** 生成批注 id */
export function createAnchorAnnotationId(): string {
  return `an_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/** 从点击目标向上找最近锚点，并计算在锚点矩形中的相对坐标 */
export function resolveAnchorFromEvent(
  root: HTMLElement,
  eventTarget: Element | null,
  clientX: number,
  clientY: number
): { anchorId: string; u: number; v: number } | null {
  if (!eventTarget || !root.contains(eventTarget)) return null;
  let node: Element | null = eventTarget;
  while (node && root.contains(node)) {
    if (node instanceof HTMLElement) {
      const aid = node.dataset.annotateAnchor;
      if (aid) {
        const r = node.getBoundingClientRect();
        const w = Math.max(r.width, 1);
        const h = Math.max(r.height, 1);
        return {
          anchorId: aid,
          u: Math.min(1, Math.max(0, (clientX - r.left) / w)),
          v: Math.min(1, Math.max(0, (clientY - r.top) / h)),
        };
      }
    }
    node = node.parentElement;
  }
  return null;
}

/** 容错解析存储中的批注数据 */
export function normalizeAnchorAnnotations(raw: unknown): AnchorAnnotation[] {
  if (!Array.isArray(raw)) return [];
  const views: AnnotationView[] = ['market', 'insights', 'keywords', 'profit'];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const o = item as Record<string, unknown>;
      if (typeof o.id !== 'string') return null;
      if (typeof o.anchorId !== 'string') return null;
      if (typeof o.text !== 'string') return null;
      if (!views.includes(o.view as AnnotationView)) return null;
      const u = Number(o.u);
      const v = Number(o.v);
      if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
      return {
        id: o.id,
        view: o.view as AnnotationView,
        anchorId: o.anchorId,
        u,
        v,
        text: o.text,
        createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
      } satisfies AnchorAnnotation;
    })
    .filter((x): x is AnchorAnnotation => Boolean(x));
}

const ANCHOR_LABELS: Record<string, string> = {
  'workspace-scroll': '主滚动内容区',
  'market-root': '市场大盘 · 整体',
  'market-kpi-header': '市场大盘 · 核心指标区',
  'market-kpi-core': '市场大盘 · 三大核心 KPI',
  'market-kpi-compete': '市场大盘 · 竞争/市场指标',
  'market-kpi-ops': '市场大盘 · 产品/运营指标',
  'market-charts': '市场大盘 · 图表区',
  'market-asin-list': '市场大盘 · ASIN 列表',
  'competitors-root': '竞品分析',
  'insights-root': '用户洞察',
  'keywords-root': '关键词分析',
  'profit-root': '利润计算器',
};

export function getAnchorDisplayName(anchorId: string): string {
  return ANCHOR_LABELS[anchorId] ?? anchorId;
}

export function getViewTabLabel(view: AnnotationView): string {
  switch (view) {
    case 'market':
      return '市场大盘';
    case 'competitors':
      return '竞品分析';
    case 'insights':
      return '用户洞察';
    case 'keywords':
      return '关键词分析';
    case 'profit':
      return '利润计算器';
  }
}
