import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from './Card';

/**
 * InfoTip —— 全 app 唯一的「信息角标」（ⓘ）实现（PRD §15.24）。
 *
 * ## 为什么要它（用户明确要求）
 * 用户原话：「需要大篇幅说明的地方，不要占用地方，做成角标来，鼠标悬浮或者点击到角标才会显示。」
 * 在此之前，界面里躺着大量"解释性长文"——卡片标题下的两三行注脚、原理科普、操作提示，
 * 它们把版面撑满、把真正的结论挤下去，而用户真正需要看的是结论与证据。
 * 所以：**解释性内容默认收起来，正文只留一句短摘要 + 一个 ⓘ**。
 *
 * ## 为什么必须"唯一实现"
 * 仓库里此前已有 3 处各写一份的手搓 tooltip（BrandLeaderboard 的 ColumnHeaderHint、
 * MetricCard 的 TooltipIcon、MarketConcentrationChart 里内联的 showHint 浮层）：
 * 它们行为各不相同（有的只能悬浮、有的不能被键盘聚焦、有的没有 Esc、有的宽度会溢出窄容器），
 * 用户遇到的就是"有的地方有角标、有的地方点不动"。本组件把这三种行为统一成一份：
 *   悬浮显示 · 点击固定（再点关闭）· Esc 关闭 · 点击外部关闭 · Tab 可聚焦 ·
 *   role="tooltip" + aria-describedby · 自动翻转/夹取到视口内 · 在窄容器里不破版。
 *
 * ## ⚠️ 什么内容**绝对不能**塞进角标（这条比"能不能省地方"重要）
 * 角标是"默认看不见"的。任何**会改变用户判断或行为**的文字一旦藏进去，就等于没写。
 * 因此以下内容必须留在正文里，**不许**收进 InfoTip：
 *   1. 硬约束与决策边界：例如「看自己里存在不满足的决策边界 ⇒ 所有机会最高只能『验证后进入』，不得直接进入」；
 *   2. 法律 / 合规 / 安全口径：密钥只存服务端、数据不出本机、合规风险、免责与不可承接边界；
 *   3. 会改变结论解读的口径：例如「判断不了 ≠ 不具备」「0 个机会是合法结论」「样本不足 ≠ 低机会」；
 *   4. 禁止性规则：例如「只有下面两种零机会写法是被允许的」；
 *   5. 错误提示、空状态与失败原因（原则：空状态必须说明原因、缺什么、如何补）；
 *   6. 用户此刻必须据此做动作的下一步指引（"下一步：点这里"）。
 * 可以进角标的是：定义与原理科普、口径的"为什么这么设计"、重复出现的同义说明、
 * 操作小提示（哪里能点什么）、以及系统确定性行为的补充解释。
 * 判断标准一句话：**藏起来会不会让用户做错决定？会 → 留在正文。不会 → 可以进角标。**
 *
 * ## 用法
 * ```tsx
 * <p className="text-sm font-semibold">
 *   角色与权限 <InfoTip title="角色与权限口径" paragraphs={[a, b, c]} />
 * </p>
 * ```
 */

export interface InfoTipProps {
  /** 浮层标题（可选，一句话） */
  title?: string;
  /** 正文段落数组（推荐：多段说明各占一段，不要再拼成一个长字符串） */
  paragraphs?: string[];
  /** 单段短文本（与 paragraphs 二选一；两者都传时 paragraphs 优先） */
  content?: string;
  /** 自由内容（优先级最高；给了就忽略 content / paragraphs） */
  children?: ReactNode;
  /** 触发按钮的无障碍名称，默认「查看说明」 */
  label?: string;
  /** 浮层最大宽度：sm = max-w-xs（默认），md = max-w-sm（内容更长时） */
  size?: 'sm' | 'md';
  /** 浮层相对角标的对齐方式（窄容器里用 end 可以避免往右溢出） */
  align?: 'center' | 'start' | 'end';
  /** 强制浮层在上/下方；默认 auto（按视口空间自动翻转） */
  side?: 'auto' | 'top' | 'bottom';
  /** 追加到浮层上的类名 */
  className?: string;
  /** 追加到外层容器（relative 锚点）上的类名 */
  wrapperClassName?: string;
}

/** 浮层与角标之间的间距 */
const GAP = 8;
/** 浮层与视口边缘的最小距离（防止贴边/溢出） */
const VIEWPORT_PAD = 8;
/** 悬浮离开后的延迟关闭时间：让鼠标能跨过 GAP 移到浮层上（选中/复制文字） */
const HOVER_CLOSE_DELAY = 120;

export function InfoTip({
  title,
  paragraphs,
  content,
  children,
  label = '查看说明',
  size = 'sm',
  align = 'center',
  side = 'auto',
  className,
  wrapperClassName,
}: InfoTipProps) {
  /** 鼠标悬浮中 */
  const [hovered, setHovered] = useState(false);
  /** 键盘聚焦中（Tab 到角标也要能看说明，不能只有鼠标用户能看） */
  const [focused, setFocused] = useState(false);
  /** 点击固定中（再点一次 / Esc / 点外部 才关闭） */
  const [pinned, setPinned] = useState(false);
  /**
   * 本轮的"点击关闭"抑制位：
   * 鼠标正悬在角标上时点第二次想关掉它，如果只看 hovered，浮层会"关了又立刻开"（看起来像坏了）。
   * 所以点击关闭时记一个抑制位，直到鼠标离开再进入（或重新聚焦）才允许悬浮再次生效。
   */
  const [dismissed, setDismissed] = useState(false);
  /** 计算后的浮层坐标（null = 还没量到，先隐藏但保留占位以便测量） */
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  const reactId = useId();
  // useId 会返回 ":r0:" 这类含冒号的字符串，冒号在 CSS 选择器里有歧义，去掉更安全
  const panelId = `infotip-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const open = (hovered && !dismissed) || focused || pinned;

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  // 悬浮关闭延迟：不加延迟时，鼠标从角标移向浮层会穿过 GAP 而立刻关闭，浮层就没法阅读/选中
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setHovered(false);
      setDismissed(false);
    }, HOVER_CLOSE_DELAY);
  };

  /**
   * 定位：浮层用 position: fixed（不是 absolute）——
   * 角标经常出现在表格表头、卡片标题这类容器里，祖先常有 overflow-hidden，
   * absolute 会被裁掉；fixed 直接相对视口，窄容器里也不会破版。
   * 水平方向再夹取到视口内，垂直方向空间不够时翻到上方。
   */
  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect();
      const p = panelRef.current?.getBoundingClientRect();
      if (!t || !p) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const fitsBelow = t.bottom + GAP + p.height <= vh - VIEWPORT_PAD;
      const useTop = side === 'top' || (side === 'auto' && !fitsBelow && t.top - GAP - p.height >= VIEWPORT_PAD);
      const rawTop = useTop ? t.top - GAP - p.height : t.bottom + GAP;

      const rawLeft = align === 'start' ? t.left : align === 'end' ? t.right - p.width : t.left + t.width / 2 - p.width / 2;
      const left = Math.min(Math.max(rawLeft, VIEWPORT_PAD), Math.max(VIEWPORT_PAD, vw - p.width - VIEWPORT_PAD));

      setCoords({ top: Math.max(VIEWPORT_PAD, rawTop), left });
    };
    place();
    window.addEventListener('resize', place);
    // capture: true —— 页面内滚动容器（表格、抽屉）滚动时也要跟着重算
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align, side]);

  // Esc 关闭（键盘用户必须能退出浮层）
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      cancelClose();
      setPinned(false);
      setHovered(false);
      setFocused(false);
      setDismissed(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  // 点击外部关闭（只针对"点击固定"状态；悬浮状态没有可关闭的东西）
  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setPinned(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [pinned]);

  // 卸载时清理定时器（避免对已卸载组件 setState）
  useEffect(() => () => cancelClose(), []);

  const body =
    children ??
    (paragraphs && paragraphs.length > 0
      ? paragraphs.map((text, i) => (
          <p key={i} className={i > 0 ? 'mt-1.5' : undefined}>
            {text}
          </p>
        ))
      : content
        ? <p>{content}</p>
        : null);

  return (
    <span
      ref={wrapRef}
      className={cn('relative inline-flex align-middle', wrapperClassName)}
      onMouseEnter={() => {
        cancelClose();
        setHovered(true);
        setDismissed(false);
      }}
      onMouseLeave={scheduleClose}
      onBlur={(event) => {
        // 焦点彻底离开这块（含浮层）才收起，避免 Tab 过程中闪断
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        // 默认不占地方：只有一个小图标，内联在标题/标签后面
        tabIndex={0}
        aria-label={label}
        aria-describedby={open ? panelId : undefined}
        aria-expanded={open}
        onClick={(event) => {
          // 角标常被放在 <label>/卡片标题里：不拦住的话点角标会顺带勾选复选框或触发卡片跳转
          event.preventDefault();
          event.stopPropagation();
          if (pinned) {
            // 再点一次关闭：同时记抑制位，否则鼠标还悬着会立刻又被 hover 打开（看起来像关不掉）
            setPinned(false);
            setDismissed(true);
          } else {
            setPinned(true);
            setDismissed(false);
          }
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onFocus={() => setFocused(true)}
        className="inline-flex items-center justify-center rounded-full p-0.5 -m-0.5 text-[#aeaeb2] hover:text-indigo-600 transition-colors cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:text-indigo-600"
      >
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="tooltip"
          style={{ top: coords?.top ?? 0, left: coords?.left ?? 0, visibility: coords ? 'visible' : 'hidden' }}
          className={cn(
            'fixed z-50 rounded-xl border border-black/8 bg-white shadow-lg px-3 py-2 text-[11px] leading-relaxed text-[#424245]',
            size === 'md' ? 'max-w-sm' : 'max-w-xs',
            className
          )}
        >
          {title && <p className="mb-1 text-[11px] font-semibold text-[#1d1d1f]">{title}</p>}
          {body}
        </div>
      )}
    </span>
  );
}
