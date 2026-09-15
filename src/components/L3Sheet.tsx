import { useEffect, type ReactNode } from 'react';
import { ArrowLeft, HelpCircle, Loader2 } from 'lucide-react';
import { cn } from './ui/Card';
import { L3_LOOK_LABELS, type L3Id, type L3Look } from '../utils/l3Pages';

/**
 * 二级页正文的注册函数（数据由"拥有它的那个视图"提供，页壳只负责渲染）。
 *
 * 为什么用"注册回调"而不是把数据搬到 ProjectWorkspace：
 * 内联区块与二级页正文必须是**同一份实现、同一份状态**（⏳3 的硬规则：不许复制一份）。
 * 状态在 UserLookView / SelfReadinessPanel / OpportunityDecisionBoard 里，
 * 所以由它们注册 `(id, cardId?) => ReactNode`，页壳在渲染时调用它。
 */
export type L3BodyRender = (id: L3Id, cardId?: string) => ReactNode;

/**
 * 区块的两种形态（⏳3 的去重约定）：
 * - `'inline'`：主屏上的内联区块，与改动前完全一致；
 * - `'sheet'`：同一个组件作为二级页正文，只隐藏"查看详情"入口、补上页号、必要时展开明细。
 * 业务数据与写回回调由外层传入，两种形态共用，**不允许**为二级页另写一份标记。
 */
export type L3BlockVariant = 'inline' | 'sheet';

/**
 * 页壳需要知道的页面信息（结构化类型，而不是写死 `L3Page`）。
 *
 * 为什么要放宽：2026-09 新增的「品牌资产与信息」页不是线框图里的编号页（⑪⑫…），
 * 但它同样需要"全屏 + 返回 + Escape + 四句契约"这套壳。放宽成结构化类型后，
 * `L3Page` 天然满足它（无需改注册表），品牌页也能复用同一个页壳 —— 不许复制第二份页壳。
 */
export interface L3SheetPageInfo {
  /** 圈号/标记（线框图编号页是 ①…⑭） */
  badge: string;
  /** 页头右上角那行归属说明（不传则默认「二级页<badge>」） */
  badgeLabel?: string;
  look: L3Look;
  title: string;
  problem: string;
  entry: string;
  backTo: string;
  depends: string;
  /** 非线框图页面的偏离说明（有值时页壳会改称「本页要求（已按用户指示调整）」） */
  deviation?: string;
}

const INFO_ITEMS: { key: keyof Pick<L3SheetPageInfo, 'problem' | 'entry' | 'backTo' | 'depends'>; label: string }[] = [
  { key: 'problem', label: '这个页面解决什么问题' },
  { key: 'entry', label: '从哪进入' },
  { key: 'backTo', label: '返回去哪' },
  { key: 'depends', label: '依赖哪些数据' },
];

/**
 * L3 二级页的通用全屏页壳（线框图 ①②③④⑪⑫⑬⑭ 共用）。
 *
 * 三条硬要求：
 * 1. **全屏盖在项目之上**：`fixed inset-0 z-50`，项目壳（含右侧决策草稿）留在下面不动；
 * 2. **返回的方式必须多**：左上「← 返回」按钮 + `Escape` + （视觉上）页头常驻，避免"进去了出不来"；
 * 3. **页面契约可见**：页头下方常驻线框图写死的四句话（解决什么问题/从哪进入/返回去哪/依赖哪些数据）。
 *
 * 视觉沿用项目既有的 indigo/紫、白卡、圆角风格（docs/product-charter.md），不重新换皮。
 * hook 全部在组件体最前面（本组件没有组件级早退），避免 React #310（见 tests/hookOrder.test.ts）。
 */
export function L3Sheet({
  page,
  onClose,
  children,
  footer,
  busy,
}: {
  page: L3SheetPageInfo;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
}) {
  // Esc 关闭
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // 打开期间锁住背后页面的滚动（关闭后还原原值，不写死 ''）
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${page.badgeLabel ?? `二级页${page.badge}`}：${page.title}`}
      className="fixed inset-0 z-50 bg-[#f5f5f7] overflow-y-auto"
    >
      {/* 页头：返回 + 圈号 + 标题 + 归属的"看" + 右侧操作位 */}
      <div className="sticky top-0 z-10 border-b border-black/5 bg-white/85 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="返回"
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/8 bg-white text-xs font-semibold text-[#424245] hover:text-indigo-600 hover:border-indigo-200 transition-all active:scale-[0.98]"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> 返回
          </button>
          <span className="shrink-0 w-7 h-7 rounded-xl bg-indigo-50 text-indigo-700 text-[13px] font-bold flex items-center justify-center">
            {page.badge}
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[#1d1d1f] truncate">{page.title}</p>
            <p className="text-[11px] text-[#86868b]">
              {L3_LOOK_LABELS[page.look]} · {page.badgeLabel ?? `二级页${page.badge}`}
            </p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {busy && <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />}
            {footer}
          </div>
        </div>
      </div>

      {/* 页面契约：让"做出来了"和"承诺了什么"在同一屏里可核对。
          有 deviation 的页（用户指示改过设计）不能再说"线框图原文" —— 否则就是界面在撒谎。 */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-4">
        <div className="rounded-[20px] border border-indigo-100 bg-indigo-50/50 px-4 py-3">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-800 mb-2">
            <HelpCircle className="w-3.5 h-3.5" />
            {page.deviation ? '本页要求（已按用户指示调整，非线框图原文）' : '线框图对这一页的要求（原文）'}
          </p>
          {page.deviation && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2 leading-relaxed">
              {page.deviation}
            </p>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
            {INFO_ITEMS.map(({ key, label }) => (
              <div key={key}>
                <dt className="text-[10px] font-semibold text-indigo-700/80">{label}</dt>
                <dd className="text-[11px] text-[#424245] leading-relaxed mt-0.5">{page[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      {/* 正文：与内联区块同一份实现（由视图注册进来） */}
      <div className={cn('max-w-5xl mx-auto px-4 sm:px-6 py-4 space-y-4')}>{children}</div>
    </div>
  );
}
