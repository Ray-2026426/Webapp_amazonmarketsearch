// M4/M5 · 独立 HTML + Markdown 审核报告（PRD §6.5 产出物 + 二级页㉑；线框图 §8 固定叙事）。
//
// 一份可以直接双击打开、发给管理层的审核件。**叙事顺序由线框图 §8 锁死**：
//   首页只放结论 → §1 研究目标 → §2 用户需求 → §3 市场细分 → §4 竞品缺口 → §5 自身适配
//   → §6 机会结论 → §7 证据索引与口径
// HTML 与 MD 共用同一份「区块」中间表示（buildReportDoc），所以两份导出的章节顺序与标题必然一致，
// 不会出现"HTML 里有、MD 里没有"的漂移。
//
// 硬要求：
// - 只渲染存在的字段，**缺数据就写"未提供"**（listing 没抓到的字段写"未抓取"），不编造数字/ASIN/评论原文；
// - 所有用户/AI 文本进 HTML 前必须过 escapeHtml；
// - 评分拆解、证据引用、决策包（路线图/前置资源/控制点）必须同屏（§8.1 硬规则④：高分≠立项）；
// - 零机会结论也要能导出（无机会本身就是要评审的结论）。
//
// 纯函数渲染（buildOpportunityReportHtml / buildOpportunityMarkdownReport）与 IO 分离，便于测试与复用。
// 四看明细（§1-§5）与 §7 的证据索引全部是**选填输入**：老调用方不传也能编译，缺的部分一律渲染成"未提供"。

import type { OpportunityCard, OpportunityDecision, ResearchProject } from '../types/researchProject';
import type { OpportunityConclusion } from '../types/opportunity';
import {
  CONFIDENCE_LABELS,
  CONTROL_POINT_LABELS,
  NO_OPPORTUNITY_LABELS,
  OPPORTUNITY_KIND_LABELS,
  RESOURCE_CATEGORY_LABELS,
  ROADMAP_PHASE_LABELS,
} from '../types/opportunity';
import { SCORE_DIMENSION_LABELS, SCORE_WEIGHTS, type ScoreDimension } from './opportunityScoreV2';
import { PROJECT_DECISION_LABELS, loadProjectDecisionSummary, type ProjectDecisionSummary } from './projectDecision';
import { loadOpportunities, loadOpportunityConclusion } from './opportunityStore';
import { loadSelfAssessment, type SelfAssessment } from './selfAssessment';
import {
  computeNeedEvidenceStrength,
  computeSearchPathFlow,
  describeSearchPathFlow,
  EVIDENCE_STRENGTH_LABELS,
  loadUserLook,
  SEARCH_PATH_LAYER_LABELS,
  SEARCH_PATH_LAYER_ORDER,
  type SearchPath,
  type UnmetNeedCandidate,
  type UserLookData,
} from './userLook';
import { loadMarketLook, type MarketLookData } from './marketLook';
import { loadCompetitorLook, type CompetitorLookData } from './competitorLook';
import {
  buildCompetitorPersona,
  buildPainMatrix,
  buildSatisfactionMatrix,
  decideWinningPath,
  SATISFACTION_LABELS,
  SATISFACTION_MARKS,
  WINNING_PATH_LABELS,
  type CompetitorPersona,
  type PainMatrix,
  type SatisfactionMatrix,
  type SatisfactionEvidence,
  type WinningPathDecision,
  type WinningPath,
} from './competitorAnalysis';
import { pickCompetitorsDetailed, ROLE_LABELS, type CompetitorRole } from './competitorPicker';
import { loadSnapshot } from './projectSnapshot';
import { loadMarketSegmentContext, type MarketSegmentContext } from './opportunityContext';
import {
  recommendScheme,
  synthesizeSegmentSchemes,
  type SchemeBasis,
  type SegmentScheme,
} from './segmentSynthesis';
import { buildComparisonTable, describeCoverage, LISTING_FIELDS, type ComparisonRow, type CoverageReport } from './listingFields';
import { buildOurCapability, computeFitScore, hardConstraintsFromSelfAssessment } from './ourCapability';
import { toAnswersForFit } from './categoryQuiz';
import { computeCompleteness, loadCapabilityLibrary } from './capabilityLibrary';
import {
  countEvidenceByLook,
  EVIDENCE_LOOK_LABELS,
  EVIDENCE_TYPE_LABELS,
  loadEvidence,
  type Evidence,
} from './evidence';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ────────────────────────── 文本兜底（缺数据一律写"未提供"，绝不编造） ────────────────────────── */

/** 通用缺失占位：字段没有数据 */
const NP = '未提供';
/** 三列对比专用占位：字段**没抓到**（与"值为空"是两件事，见 listingFields.ts） */
const NF = '未抓取';

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function orNp(v: unknown, fallback = NP): string {
  const t = s(v);
  return t || fallback;
}

function listText(v: unknown, sep = '、', empty = NP): string {
  const list = Array.isArray(v) ? v.map((x) => s(x)).filter(Boolean) : [];
  return list.length ? list.join(sep) : empty;
}

function num(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : NP;
}

function pct(v: unknown, digits = 0): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : NP;
}

function money(v?: number): string {
  return typeof v === 'number' && Number.isFinite(v) ? `$${Math.round(v).toLocaleString()}` : NP;
}

function isoTime(v?: string): string {
  const t = s(v);
  return t ? t.slice(0, 19).replace('T', ' ') : NP;
}

/** HTML 报告里那排 ████░（只在 HTML 里画，MD 用数字，口径一致） */
function bar(score: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(score / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${score}`;
}

const CARD_DECISION_LABELS: Record<OpportunityDecision, string> = {
  enter: '进入',
  validate_first: '验证后进入',
  hold: '暂缓',
  reject: '放弃',
  undecided: '未拍板',
};

/** 结论一句话 + 状态标签：两者的措辞常常重合，重合时不重复写一遍 */
function headlineWithStatus(headline: string, statusLabel: string): string {
  if (!headline) return statusLabel;
  return headline.includes(statusLabel) ? headline : `${headline}（${statusLabel}）`;
}

const SCHEME_BASIS_LABELS: Record<SchemeBasis, string> = {
  demand: '需求域（看用户的需求分类；一个商品只归一个需求域）',
  attribute: '价格段 × 商品属性（两两互斥，必须切满）',
  title: '竞品标题聚类（标题词频；一个商品只归一个词簇）',
};

const SATISFACTION_EVIDENCE_LABELS: Record<SatisfactionEvidence['where'], string> = {
  title: '标题',
  listing: 'Listing 五点',
  review_positive: '好评原文',
  review_negative: '差评原文',
};

const WINNING_PATH_ORDER: WinningPath[] = ['unique', 'better', 'cheaper', 'none'];

/** §4 三列对比"摘要"里展示的关键字段（顺序即展示顺序；清单外字段仍是抓过的，只是不进摘要） */
const KEY_COMPARISON_FIELD_KEYS = [
  'price',
  'rating',
  'reviewCount',
  'monthlySales',
  'monthlyRevenue',
  'bsr',
  'fbaFee',
  'sellerType',
  'launchDate',
  'brandMaker',
  'mainImages',
  'video',
  'title',
  'bullets',
  'aplus',
  'titleKeywords',
  'trafficKeywords',
  'abaRank',
  'adDependency',
  'avgReviewGrowth',
  'priceGapToAvg',
];

/* ────────────────────────── 报告输入 ────────────────────────── */

/** §5 适配度（computeFitScore 的产物；口径说明一起带进来，便于复核） */
export interface ReportFitScore {
  fitScore: number;
  answered: number;
  excluded: number;
  backgroundCompleteness: number;
  /** 确定性口径说明（含"相关题 N 道 × 背景库完整度"的算式） */
  note: string;
}

export interface OpportunityReportInput {
  project: ResearchProject;
  cards: OpportunityCard[];
  conclusion: OpportunityConclusion | null;
  decision: ProjectDecisionSummary;
  /** 四看摘要（人话；没有就写未提供） */
  fourLook: { user: string; market: string; competitor: string; self: string; hardConstraint: string };

  /* ── 以下全部选填：线框图 §1-§7 固定叙事需要的四看原始数据 ── */

  /** §2 看用户：搜索路径（四层）+ 需求分类树（每条带证据） */
  userLook?: UserLookData | null;
  /** §3 看市场：吸引力判断、风险、方案与目标细分选择 */
  marketLook?: MarketLookData | null;
  /** §4 看竞对：样本池/listing 明细/缺口/壁垒 */
  competitorLook?: CompetitorLookData | null;
  /** §5 看自己：自评项 + 硬约束结论 */
  selfLook?: SelfAssessment | null;
  /** §3 细分三方合成方案（synthesizeSegmentSchemes 的产物：方案 A/B/C） */
  segmentSchemes?: SegmentScheme[] | null;
  /** §3 目标细分口径（loadMarketSegmentContext 的产物：用户选定的细分 + 机会分口径） */
  segmentContext?: MarketSegmentContext | null;
  /** §4 三列的角色（pickCompetitorsDetailed 的产物：谁是头部/跟随者/新人，含判定依据） */
  competitorRoles?: { asin: string; role: CompetitorRole; reason: string; note?: string }[] | null;
  /** §4 三列对比表（buildComparisonTable 的产物；没抓到的字段是"未抓取"） */
  listingComparison?: { rows: ComparisonRow[]; coverage: CoverageReport } | null;
  /** §4 痛点未满足矩阵（buildPainMatrix 的产物） */
  painMatrices?: PainMatrix[] | null;
  /** §4 需求满足矩阵（buildSatisfactionMatrix 的产物；●◐○—） */
  satisfactionMatrices?: SatisfactionMatrix[] | null;
  /** §4 用户画像（buildCompetitorPersona 的产物） */
  personas?: CompetitorPersona[] | null;
  /** §4 赢的路径（decideWinningPath 的产物，确定性判定，AI 不可改） */
  winningPath?: WinningPathDecision | null;
  /** §5 适配度（computeFitScore 的产物） */
  fitScore?: ReportFitScore | null;
  /** §7 项目全部 Evidence（loadEvidence 的产物，用于证据索引） */
  evidence?: Evidence[] | null;
  /** 首页"分析口径"一行（来自项目快照的真实计数） */
  sample?: { products: number; reviews: number; keywords: number; competitors: number } | null;
}

/* ────────────────────────── 区块中间表示（HTML / MD 共用，保证两份导出同构） ────────────────────────── */

/** 一段文本：字符串走各自转义；对象形式用于 HTML 需要富文本（条形图/红字/勾选框）的地方 */
type Text = string | { html: string; md: string };

type Block =
  | { kind: 'h3'; text: Text }
  | { kind: 'h4'; text: Text }
  | { kind: 'sub'; text: Text }
  | { kind: 'p'; text: Text; variant?: 'meta' | 'headline' | 'warn' }
  | { kind: 'kv'; rows: { label: Text; value: Text }[] }
  | { kind: 'table'; head: Text[]; rows: Text[][] }
  | { kind: 'ul'; items: Text[] }
  | { kind: 'ol'; items: Text[] };

interface ReportSection {
  num: number;
  title: string;
  blocks: Block[];
}

interface ReportDoc {
  title: string;
  meta: string[];
  /** 首页结论（在 §1 之前；"首页只放结论"） */
  conclusion: Block[];
  sections: ReportSection[];
}

function htmlText(t: Text): string {
  return typeof t === 'string' ? escapeHtml(t) : t.html;
}

function mdText(t: Text): string {
  const raw = typeof t === 'string' ? t : t.md;
  return String(raw ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderBlocksHtml(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'h3':
          return `<h3>${htmlText(b.text)}</h3>`;
        case 'h4':
          return `<h4>${htmlText(b.text)}</h4>`;
        case 'sub':
          return `<p class="phase">${htmlText(b.text)}</p>`;
        case 'p':
          return `<p${b.variant ? ` class="${b.variant}"` : ''}>${htmlText(b.text)}</p>`;
        case 'kv':
          return `<table class="kv">\n${b.rows
            .map((r) => `<tr><th>${htmlText(r.label)}</th><td>${htmlText(r.value)}</td></tr>`)
            .join('\n')}\n</table>`;
        case 'table':
          return `<table class="grid">\n<tr>${b.head
            .map((h) => `<th>${htmlText(h)}</th>`)
            .join('')}</tr>\n${b.rows.map((r) => `<tr>${r.map((c) => `<td>${htmlText(c)}</td>`).join('')}</tr>`).join('\n')}\n</table>`;
        case 'ul':
          return `<ul>\n${b.items.map((i) => `<li>${htmlText(i)}</li>`).join('\n')}\n</ul>`;
        case 'ol':
          return `<ol>\n${b.items.map((i) => `<li>${htmlText(i)}</li>`).join('\n')}\n</ol>`;
        default:
          return '';
      }
    })
    .join('\n');
}

function renderBlocksMd(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'h3':
        out.push('', `### ${mdText(b.text)}`, '');
        break;
      case 'h4':
        out.push('', `#### ${mdText(b.text)}`, '');
        break;
      case 'sub':
        out.push(`**${mdText(b.text)}**`, '');
        break;
      case 'p': {
        const t = mdText(b.text);
        if (b.variant === 'headline') out.push(`**${t}**`, '');
        else if (b.variant === 'warn') out.push(`> ⚠ ${t}`, '');
        else if (b.variant === 'meta') out.push(`*${t}*`, '');
        else out.push(t, '');
        break;
      }
      case 'kv':
        out.push('| 字段 | 内容 |', '| --- | --- |');
        for (const r of b.rows) out.push(`| ${mdText(r.label)} | ${mdText(r.value)} |`);
        out.push('');
        break;
      case 'table':
        out.push(`| ${b.head.map(mdText).join(' | ')} |`, `| ${b.head.map(() => '---').join(' | ')} |`);
        for (const r of b.rows) out.push(`| ${r.map(mdText).join(' | ')} |`);
        out.push('');
        break;
      case 'ul':
        for (const i of b.items) out.push(`- ${mdText(i)}`);
        out.push('');
        break;
      case 'ol':
        b.items.forEach((i, idx) => out.push(`${idx + 1}. ${mdText(i)}`));
        out.push('');
        break;
      default:
        break;
    }
  }
  return out;
}

/* ────────────────────────── 首页结论（§1 之前；"首页只放结论"） ────────────────────────── */

function conclusionBlocks(input: OpportunityReportInput, cards: OpportunityCard[], evidence: Evidence[]): Block[] {
  const decision = input.decision;
  const statusLabel = decision ? PROJECT_DECISION_LABELS[decision.status] ?? NP : NP;
  const reasons = Array.isArray(decision?.reasons) ? decision!.reasons.filter((r) => s(r)) : [];
  const holdCount = cards.filter((c) => c.decision === 'hold').length;
  const sample = input.sample ?? null;

  return [
    { kind: 'h3', text: '结论（Go / No-Go）' },
    { kind: 'p', variant: 'headline', text: `结论：${headlineWithStatus(orNp(decision?.headline), statusLabel)}` },
    { kind: 'p', text: `一句话理由：${reasons.length ? reasons[0] : NP}` },
    {
      kind: 'p',
      variant: 'meta',
      text: `Go/No-Go 状态：${statusLabel} ｜ 机会 ${cards.length} ｜ 暂缓 ${holdCount} ｜ 证据 ${evidence.length} 条 ｜ 已拍板 ${num(
        decision?.decidedCount
      )} 张`,
    },
    {
      kind: 'p',
      variant: 'meta',
      text: sample
        ? `分析口径：商品样本 ${num(sample.products)} 个 ｜ 评论样本 ${num(sample.reviews)} 条 ｜ 关键词 ${num(sample.keywords)} 个 ｜ 竞对 ${num(sample.competitors)} 个`
        : `分析口径：${NP}`,
    },
  ];
}

/* ────────────────────────── §1 研究目标 ────────────────────────── */

function section1(input: OpportunityReportInput): Block[] {
  const p = input.project;
  const priceRange =
    p?.targetPriceRange && typeof p.targetPriceRange.min === 'number' && typeof p.targetPriceRange.max === 'number'
      ? `$${Math.round(p.targetPriceRange.min)} – $${Math.round(p.targetPriceRange.max)}`
      : NP;
  const fourLook = input.fourLook ?? ({} as OpportunityReportInput['fourLook']);

  return [
    {
      kind: 'kv',
      rows: [
        { label: '项目名称', value: orNp(p?.name) },
        { label: '站点', value: orNp(p?.marketplace) },
        { label: '研究目标', value: orNp(p?.objective) },
        { label: '品类', value: listText(p?.categories) },
        { label: '核心关键词（输入）', value: listText(p?.coreKeywords) },
        { label: '种子 ASIN（输入）', value: listText(p?.seedAsins) },
        { label: '目标人群', value: orNp(p?.targetUsers) },
        { label: '目标售价区间', value: priceRange },
        { label: '目标毛利率', value: typeof p?.targetGrossMargin === 'number' ? pct(p.targetGrossMargin) : NP },
        { label: '计划上市时间', value: orNp(p?.plannedLaunchDate) },
        { label: '项目更新时间', value: isoTime(p?.updatedAt) },
      ],
    },
    { kind: 'h3', text: '四看摘要（各看一句话）' },
    {
      kind: 'table',
      head: ['看', '摘要'],
      rows: [
        ['看用户', orNp(fourLook.user)],
        ['看市场', orNp(fourLook.market)],
        ['看竞对', orNp(fourLook.competitor)],
        ['看自己', orNp(fourLook.self)],
        ['硬约束', orNp(fourLook.hardConstraint, '未触发')],
      ],
    },
  ];
}

/* ────────────────────────── §2 用户需求 ────────────────────────── */

function searchPathBlocks(path: SearchPath | undefined | null): Block[] {
  const blocks: Block[] = [];
  const layers = Array.isArray(path?.layers) ? path!.layers : [];
  if (layers.length === 0) {
    blocks.push({ kind: 'p', text: '未提供（看用户里还没有搜索路径：先在「看用户」跑一次四层搜索路径分析）' });
    return blocks;
  }
  if (s(path?.summary)) blocks.push({ kind: 'p', variant: 'meta', text: `搜索路径结论：${s(path!.summary)}` });

  const flows = computeSearchPathFlow(path);
  blocks.push({ kind: 'p', variant: 'meta', text: `层间流向（确定性）：${describeSearchPathFlow(flows)}` });

  const rows: Text[][] = SEARCH_PATH_LAYER_ORDER.map((layerId) => {
    const layer = layers.find((l) => l && l.layer === layerId);
    const words = (layer?.words ?? []).filter((w) => w && s(w.word));
    const wordText = words.length
      ? words
          .map((w) => `${s(w.word)}（占比 ${pct(w.share)} ｜ 月搜索量 ${num(w.volume)}）`)
          .join('；')
      : NP;
    const volume = words.reduce((sum, w) => sum + (typeof w.volume === 'number' && Number.isFinite(w.volume) ? w.volume : 0), 0);
    const totalText = words.length ? `词 ${words.length} 个 ｜ 合计月搜索量 ${num(volume)}` : NP;
    const flow = flows.find((f) => f.layer === layerId);
    const flowText =
      flow && flow.retention !== null
        ? `相对上一层保留 ${pct(flow.retention)}（${flow.basis === 'words' ? '词数口径' : '搜索量口径'}）`
        : orNp(flow?.note, NP);
    return [SEARCH_PATH_LAYER_LABELS[layerId], wordText, totalText, flowText];
  });
  blocks.push({ kind: 'table', head: ['层级', '词（占比 / 月搜索量）', '本层合计', '流向'], rows });
  return blocks;
}

function needTreeBlocks(userLook: UserLookData | null | undefined): Block[] {
  const blocks: Block[] = [];
  const needs = (Array.isArray(userLook?.unmetNeedCandidates) ? userLook!.unmetNeedCandidates : []).filter(
    (n) => n && (s(n.needStatement) || s(n.category))
  );
  if (needs.length === 0) {
    blocks.push({ kind: 'p', text: '未提供（看用户里还没有未满足需求候选：先在「看用户」把需求分类树跑出来）' });
    return blocks;
  }

  const groups = new Map<string, UnmetNeedCandidate[]>();
  for (const n of needs) {
    const category = s(n.category) || '未分类需求';
    groups.set(category, [...(groups.get(category) ?? []), n]);
  }

  const rows: Text[][] = [];
  for (const [category, list] of groups) {
    list.forEach((n, i) => {
      const ev = computeNeedEvidenceStrength(n.evidence);
      const keywords = (n.evidence?.keywords ?? []).filter((k) => k && s(k.word));
      const quotes = (n.evidence?.reviewQuotes ?? []).filter((q) => q && s(q.quote));
      const asins = (n.evidence?.asins ?? []).map((a) => s(a)).filter(Boolean);
      rows.push([
        i === 0 ? category : '〃（同需求域）',
        orNp(n.needStatement),
        s(n.subCategory) || NP,
        `${EVIDENCE_STRENGTH_LABELS[n.evidenceStrength] ?? NP}（看用户标注）｜ 确定性证据分 ${ev.score}/100`,
        keywords.length
          ? keywords.map((k) => `${s(k.word)}${typeof k.volume === 'number' ? `（月搜索量 ${num(k.volume)}）` : ''}`).join('；')
          : NP,
        quotes.length ? quotes.map((q) => `「${s(q.quote)}」${s(q.asin) ? `（${s(q.asin)}）` : ''}`).join('；') : NP,
        asins.length ? asins.join('、') : NP,
      ]);
    });
  }
  blocks.push({
    kind: 'table',
    head: ['需求域', '需求', '子需求', '证据强度', '关键词证据', '评论原文', '覆盖 ASIN'],
    rows,
  });
  blocks.push({
    kind: 'p',
    variant: 'meta',
    text: '证据强度口径（确定性）：关键词每条 +12（上限 36）、评论原文每条 +18（上限 54）、覆盖 ASIN 每个 +5（上限 20），三类齐全再 +10；≥70 高 / ≥40 中 / 其余低。',
  });
  return blocks;
}

function section2(input: OpportunityReportInput): Block[] {
  const userLook = input.userLook ?? null;
  const blocks: Block[] = [
    { kind: 'p', variant: 'headline', text: `看用户一句话：${orNp(input.fourLook?.user)}` },
    {
      kind: 'p',
      variant: 'meta',
      text: `目标用户：${orNp(userLook?.targetUser)} ｜ 使用场景：${orNp(userLook?.scenario)} ｜ JTBD：${orNp(userLook?.jobToBeDone)}`,
    },
    { kind: 'h4', text: '搜索路径（认知 → 考虑 → 决策 → 场景）' },
  ];
  blocks.push(...searchPathBlocks(userLook?.searchPath));
  blocks.push({ kind: 'h4', text: '需求分类树（需求域 → 需求，每条带证据）' });
  blocks.push(...needTreeBlocks(userLook));
  return blocks;
}

/* ────────────────────────── §3 市场细分 ────────────────────────── */

function segmentRows(segments: SegmentScheme['segments']): Text[][] {
  return [...(segments ?? [])]
    .sort((a, b) => (b.score?.opportunity ?? 0) - (a.score?.opportunity ?? 0))
    .map((sg) => [
      orNp(sg.name),
      num(sg.score?.opportunity),
      num(sg.score?.trend),
      num(sg.score?.volume),
      num(sg.score?.competition),
      num(sg.productCount),
      pct(sg.revenueShare),
    ]);
}

const SEGMENT_TABLE_HEAD: Text[] = ['细分名', '机会分', '趋势', '体量', '竞争', '商品数', '收入占比'];

function section3(input: OpportunityReportInput): Block[] {
  const blocks: Block[] = [];
  const marketLook = input.marketLook ?? null;
  const schemes = (Array.isArray(input.segmentSchemes) ? input.segmentSchemes : []).filter(Boolean);

  blocks.push({ kind: 'p', variant: 'headline', text: `看市场一句话：${orNp(input.fourLook?.market)}` });
  blocks.push({
    kind: 'kv',
    rows: [
      { label: '市场吸引力判断（看市场）', value: orNp(marketLook?.attractiveness) },
      { label: '主要市场风险（看市场）', value: listText(marketLook?.risks, '；') },
    ],
  });

  /* 方案（谁切的、切出几个） */
  blocks.push({ kind: 'h4', text: '细分方案（谁切的、切出几个）' });
  if (schemes.length === 0) {
    blocks.push({
      kind: 'p',
      text: '未提供（还没有细分方案：项目快照里没有商品样本，或还没在看市场跑三方合成）',
    });
  } else {
    blocks.push({
      kind: 'p',
      variant: 'meta',
      text: '切法（三条确定性规则各切一版，由你在看市场做选择题）：① 需求域（接看用户）② 价格段 × 商品属性 ③ 竞品标题聚类。AI 只解释差异，不改分、不选方案。',
    });
    blocks.push({
      kind: 'table',
      head: ['方案', '切法依据', '细分个数', '未归属商品', '覆盖率', '需求挂钩度', '收入加权机会分'],
      rows: schemes.map((sc) => [
        orNp(sc.name),
        SCHEME_BASIS_LABELS[sc.basis] ?? NP,
        num((sc.segments ?? []).length),
        num(sc.unassigned),
        pct(sc.coverage),
        pct(sc.grounding),
        num(sc.avgOpportunity),
      ]),
    });
    blocks.push({ kind: 'ul', items: schemes.map((sc) => `${orNp(sc.name)}：${orNp(sc.description)}`) });
  }

  /* 评分排行 */
  blocks.push({ kind: 'h4', text: '细分评分排行' });
  const chosenSchemeId = s(marketLook?.segmentSchemeId);
  const chosenScheme = schemes.find((sc) => sc.id === chosenSchemeId) ?? null;
  const recommendation = schemes.length > 0 ? recommendScheme(schemes) : null;
  const suggestedScheme = recommendation ? schemes.find((sc) => sc.id === recommendation.schemeId) ?? null : null;
  const shownScheme = chosenScheme ?? suggestedScheme ?? schemes[0] ?? null;

  if (!shownScheme) {
    blocks.push({ kind: 'p', text: '未提供（没有可用细分方案，无法排行）' });
  } else {
    blocks.push({
      kind: 'p',
      variant: 'meta',
      text: chosenScheme
        ? `排行口径：按用户在看市场**选定的方案**「${orNp(shownScheme.name)}」`
        : suggestedScheme
          ? `排行口径：用户尚未选定方案，默认展示系统建议的方案「${orNp(shownScheme.name)}」（确定性推荐，不是 AI 选的）`
          : `排行口径：用户尚未选定方案，默认展示第一个方案「${orNp(shownScheme.name)}」`,
    });
    if (!chosenScheme && recommendation) {
      blocks.push({ kind: 'p', variant: 'meta', text: `系统建议：${orNp(recommendation.reason)}` });
    }
    const segs = (shownScheme.segments ?? []).filter(Boolean);
    if (segs.length === 0) blocks.push({ kind: 'p', text: '未提供（该方案没有切出任何细分）' });
    else blocks.push({ kind: 'table', head: SEGMENT_TABLE_HEAD, rows: segmentRows(segs) });
  }

  /* 目标细分（用户选定） */
  blocks.push({ kind: 'h4', text: '目标细分（用户选定）' });
  const context = input.segmentContext ?? null;
  const targets = Array.isArray(context?.targets) ? context!.targets : [];
  if (targets.length === 0) {
    blocks.push({ kind: 'p', text: '未提供（还没有选定目标细分：先在看市场选方案并勾选细分）' });
    blocks.push({ kind: 'p', variant: 'meta', text: `口径说明：${orNp(context?.note, '未提供（没有目标细分上下文）')}` });
  } else {
    blocks.push({
      kind: 'table',
      head: ['目标细分', '机会分', '趋势', '体量', '竞争', '商品数', '收入占比'],
      rows: targets.map((t) => [
        orNp(t.name),
        num(t.opportunity),
        num(t.trend),
        num(t.volume),
        num(t.competition),
        num(t.productCount),
        pct(t.revenueShare),
      ]),
    });
    blocks.push({ kind: 'p', variant: 'meta', text: `口径说明：${orNp(context?.note)}` });
  }
  blocks.push({
    kind: 'p',
    variant: 'meta',
    text: '细分机会分口径（确定性）：趋势 35% + 体量 35% + 竞争 30%（segmentScore 固定权重）；未选目标细分时，机会卡的市场机会按全市场分 × 0.6 折算。',
  });
  return blocks;
}

/* ────────────────────────── §4 竞品缺口 ────────────────────────── */

function personaBlocks(persona: CompetitorPersona | undefined): Block[] {
  if (!persona) return [{ kind: 'p', text: '未提供（该 ASIN 没有画像数据）' }];
  const audience = (persona.audience ?? []).filter((a) => a && s(a.keyword));
  const scenarios = (persona.scenarios ?? []).filter((a) => a && s(a.keyword));
  const demands = (persona.demands ?? []).filter((d) => d && s(d.needStatement));
  const gaps = (persona.gaps ?? []).filter((g) => s(g));
  return [
    {
      kind: 'table',
      head: ['维度', '结论（每条挂评论原文）'],
      rows: [
        [
          '谁在买',
          audience.length
            ? audience.map((a) => `${s(a.keyword)}（原文：「${s(a.evidence?.quote) || NP}」）`).join('；')
            : NP,
        ],
        [
          '什么场景用',
          scenarios.length
            ? scenarios.map((a) => `${s(a.keyword)}（原文：「${s(a.evidence?.quote) || NP}」）`).join('；')
            : NP,
        ],
        [
          '核心诉求（按评论命中排序）',
          demands.length
            ? demands
                .map(
                  (d, i) =>
                    `${i + 1}. ${s(d.needStatement)}（${d.polarity === 'negative' ? '负面' : '正面'}：「${s(d.evidence?.quote) || NP}」）`
                )
                .join('；')
            : NP,
        ],
        ['数据缺什么（不编造画像）', gaps.length ? gaps.join('；') : NP],
      ],
    },
  ];
}

function painBlocks(pain: PainMatrix | undefined): Block[] {
  if (!pain) return [{ kind: 'p', text: '未提供（该 ASIN 没有痛点矩阵）' }];
  const blocks: Block[] = [
    {
      kind: 'p',
      variant: 'meta',
      text: `评论 ${num(pain.reviewCount)} 条 ｜ 差评（1-3 星）${num(pain.negativeCount)} 条 ｜ 差评率 ${pct(pain.negativeRate)}${
        s(pain.note) ? ` ｜ ${s(pain.note)}` : ''
      }`,
    },
  ];
  const hits = (pain.hits ?? []).filter((h) => h);
  if (hits.length === 0) {
    blocks.push({ kind: 'p', text: '未提供痛点分类（没有差评样本：不是"没有痛点"，是没证据）' });
  } else {
    blocks.push({
      kind: 'table',
      head: ['痛点分类', '条数', '占差评比', '命中需求域', '评论原文'],
      rows: hits.map((h) => [
        orNp(h.label),
        num(h.count),
        pct(h.share, 1),
        (h.demandCategories ?? []).length ? h.demandCategories.join('、') : NP,
        (h.quotes ?? []).length
          ? h.quotes.map((q) => `「${s(q.quote) || NP}」（${s(q.asin) || NP}，${num(q.rating)}★）`).join('；')
          : NP,
      ]),
    });
  }
  const untouched = (pain.untouchedDemandCategories ?? []).filter((c) => s(c));
  if (untouched.length > 0) {
    blocks.push({ kind: 'p', variant: 'meta', text: `差评未触达的需求域（≠已满足，只是没暴露问题）：${untouched.join('、')}` });
  }
  return blocks;
}

function satisfactionBlocks(sat: SatisfactionMatrix | undefined): Block[] {
  if (!sat) return [{ kind: 'p', text: '未提供（该 ASIN 没有满足矩阵）' }];
  const blocks: Block[] = [
    {
      kind: 'p',
      variant: 'meta',
      text: `●满足 ${num(sat.met)} ｜ ◐部分满足 ${num(sat.partial)} ｜ ○未满足 ${num(sat.unmet)} ｜ —未提及 ${num(sat.unmentioned)}${
        s(sat.note) ? ` ｜ ${s(sat.note)}` : ''
      }`,
    },
  ];
  const cells = (sat.cells ?? []).filter((c) => c);
  if (cells.length === 0) {
    blocks.push({ kind: 'p', text: '未提供（还没有需求可以做满足矩阵）' });
  } else {
    blocks.push({
      kind: 'table',
      head: ['标记', '需求', '需求域', '证据（原文 / 标题）'],
      rows: cells.map((c) => [
        `${SATISFACTION_MARKS[c.status] ?? '—'} ${SATISFACTION_LABELS[c.status] ?? NP}`,
        orNp(c.needStatement),
        orNp(c.category),
        (c.evidence ?? []).length
          ? c.evidence
              .map((e) => `${SATISFACTION_EVIDENCE_LABELS[e.where] ?? e.where}：「${s(e.quote) || NP}」`)
              .join('；')
          : NP,
      ]),
    });
  }
  return blocks;
}

function winningPathBlocks(wp: WinningPathDecision | null | undefined): Block[] {
  const blocks: Block[] = [];
  if (!wp) {
    blocks.push({ kind: 'p', text: '未提供（还没有完成三列对比与满足矩阵，做不了赢的路径判定）' });
    blocks.push({
      kind: 'table',
      head: ['路径', '是否成立', '判定依据'],
      rows: WINNING_PATH_ORDER.map((k) => [WINNING_PATH_LABELS[k], NP, NP]),
    });
    return blocks;
  }
  blocks.push({ kind: 'p', variant: 'headline', text: `判定：${orNp(wp.label)} — ${orNp(wp.conclusion)}` });
  const checks = (wp.checks ?? []).filter((c) => c);
  blocks.push({
    kind: 'table',
    head: ['路径', '是否成立', '判定依据'],
    rows: checks.length
      ? checks.map((c) => [orNp(c.label), c.holds ? '成立' : '不成立', orNp(c.detail)])
      : WINNING_PATH_ORDER.map((k) => [WINNING_PATH_LABELS[k], NP, NP]),
  });
  const reasons = (wp.reasons ?? []).filter((r) => s(r));
  if (reasons.length > 0) {
    blocks.push({ kind: 'sub', text: '支撑本结论的要点' });
    blocks.push({ kind: 'ul', items: reasons });
  }
  const blockers = (wp.blockers ?? []).filter((b) => s(b));
  if (blockers.length > 0) {
    blocks.push({ kind: 'sub', text: '卡点' });
    blocks.push({ kind: 'ul', items: blockers });
  }
  blocks.push({
    kind: 'p',
    variant: 'meta',
    text: `是否可以"直接进入"：${
      wp.canEnterDirectly ? '可以（仍需人工拍板）' : '不可以（存在无赢面卡点或硬约束否决，最高只能"验证后进入"）'
    }`,
  });
  return blocks;
}

function section4(input: OpportunityReportInput): Block[] {
  const blocks: Block[] = [];
  const competitorLook = input.competitorLook ?? null;
  const roles = (Array.isArray(input.competitorRoles) ? input.competitorRoles : []).filter((r) => r && s(r.asin));
  const comparison = input.listingComparison ?? null;
  const comparisonColumns = comparison
    ? [...new Set((comparison.rows ?? []).flatMap((r) => (r.cells ?? []).map((c) => s(c.asin))).filter(Boolean))]
    : [];
  const columns = roles.length > 0 ? roles.map((r) => s(r.asin)) : comparisonColumns;
  const roleOf = (asin: string): CompetitorRole | undefined => roles.find((r) => s(r.asin) === asin)?.role;

  blocks.push({ kind: 'p', variant: 'headline', text: `看竞对一句话：${orNp(input.fourLook?.competitor)}` });

  /* 三列对比摘要 */
  blocks.push({ kind: 'h4', text: '三列对比摘要（角色与关键字段）' });
  if (columns.length === 0) {
    blocks.push({ kind: 'p', text: '未提供（还没有竞对样本池：先在「看竞对」挑 3 个竞对）' });
  } else {
    if (roles.length > 0) {
      blocks.push({
        kind: 'table',
        head: ['ASIN', '角色', '为什么选它（确定性判定依据）'],
        rows: roles.map((r) => [s(r.asin), ROLE_LABELS[r.role] ?? NP, orNp(r.reason)]),
      });
    } else {
      blocks.push({ kind: 'p', variant: 'meta', text: `未提供角色记录（三列里只显示 ASIN：${columns.join('、')}）` });
    }

    if (comparison) {
      const rows: Text[][] = [];
      for (const field of LISTING_FIELDS) {
        if (!KEY_COMPARISON_FIELD_KEYS.includes(field.key)) continue;
        const row = (comparison.rows ?? []).find((r) => r.field?.key === field.key);
        rows.push([
          field.label,
          ...columns.map((asin) => {
            const cell = row?.cells?.find((c) => s(c.asin) === asin);
            if (!cell) return NF;
            if (cell.missing) return NF;
            return s(cell.value) || NP;
          }),
        ]);
      }
      blocks.push({ kind: 'table', head: ['字段', ...columns], rows });
      blocks.push({ kind: 'p', variant: 'meta', text: `字段抓取率：${describeCoverage(comparison.coverage)}` });
      blocks.push({
        kind: 'p',
        variant: 'meta',
        text: `"${NF}"=这个字段没抓到（不是"值为空"）：🖥前台抓商品页即可，🔮卖家精灵需要接口/导出表，📊推算由已有字段确定性算出。`,
      });
    } else {
      blocks.push({ kind: 'p', text: '未提供（还没有三列对比表）' });
    }
  }

  /* 每竞对三块分析 */
  blocks.push({ kind: 'h4', text: '每竞对三块分析（画像 / 痛点未满足矩阵 / 需求满足矩阵）' });
  if (columns.length === 0) {
    blocks.push({ kind: 'p', text: '未提供（没有竞对 ASIN，无法做三块分析）' });
  } else {
    for (const asin of columns) {
      const role = roleOf(asin);
      blocks.push({ kind: 'h4', text: `${asin}${role ? `（${ROLE_LABELS[role] ?? role}）` : ''}` });

      blocks.push({ kind: 'sub', text: '① 用户画像（谁在买 / 什么场景 / 诉求排序）' });
      blocks.push(...personaBlocks((input.personas ?? []).find((p) => p && s(p.asin) === asin)));

      blocks.push({ kind: 'sub', text: '② 痛点未满足矩阵（差评分类 × 需求域）' });
      blocks.push(...painBlocks((input.painMatrices ?? []).find((m) => m && s(m.asin) === asin)));

      blocks.push({ kind: 'sub', text: '③ 需求满足矩阵（● 满足 / ◐ 部分满足 / ○ 未满足 / — 未提及）' });
      blocks.push(...satisfactionBlocks((input.satisfactionMatrices ?? []).find((m) => m && s(m.asin) === asin)));
    }
  }

  /* 赢的路径 */
  blocks.push({ kind: 'h4', text: '赢的路径（人无我有 / 人有我优 / 人优我廉 / 无赢面）' });
  blocks.push(...winningPathBlocks(input.winningPath));

  /* 人工填写的缺口与壁垒 */
  blocks.push({ kind: 'h4', text: '竞对缺口清单与壁垒（看竞对里人工填写）' });
  blocks.push({
    kind: 'kv',
    rows: [
      { label: '未充分满足的产品缺口', value: listText(competitorLook?.gaps, '；') },
      { label: '产品与经营壁垒', value: orNp(competitorLook?.barriers) },
      { label: '需求满足矩阵（人工描述）', value: orNp(competitorLook?.needMatrix) },
      { label: '竞品样本池', value: listText(competitorLook?.samplePool) },
      { label: '标杆 ASIN', value: listText(competitorLook?.benchmarkAsins) },
    ],
  });
  return blocks;
}

/* ────────────────────────── §5 自身适配 ────────────────────────── */

function section5(input: OpportunityReportInput): Block[] {
  const blocks: Block[] = [];
  const selfLook = input.selfLook ?? null;
  const fit = input.fitScore ?? null;

  blocks.push({ kind: 'p', variant: 'headline', text: `看自己一句话：${orNp(input.fourLook?.self)}` });

  /* 适配度 */
  blocks.push({ kind: 'h4', text: '适配度（分数 + 口径说明）' });
  if (fit) {
    blocks.push({
      kind: 'kv',
      rows: [
        { label: '适配度（0-100）', value: `${num(fit.fitScore)}/100` },
        { label: '计入的相关题', value: `${num(fit.answered)} 道（"待确认"排除 ${num(fit.excluded)} 道，不进分母）` },
        { label: '背景库完整度', value: pct(fit.backgroundCompleteness) },
        { label: '口径说明（确定性算式）', value: orNp(fit.note) },
      ],
    });
  } else {
    blocks.push({ kind: 'p', text: '未提供（还没有可计入的品类选择题答案：先在看自己把相关题答完）' });
    blocks.push({
      kind: 'kv',
      rows: [
        { label: '适配度（0-100）', value: NP },
        { label: '计入的相关题', value: NP },
        { label: '背景库完整度', value: NP },
        { label: '口径说明（确定性算式）', value: NP },
      ],
    });
  }
  blocks.push({
    kind: 'p',
    variant: 'meta',
    text: '适配度口径（固定）：适配度 = 相关题均分（已具备 1 / 部分具备 0.5 / 不具备 0；"待确认"不计入分母）× 背景库完整度。适配度与"完成度"分离 —— 填得多不等于适配好，这里是"答得多好"。',
  });
  const items = (Array.isArray(selfLook?.items) ? selfLook!.items : []).filter((i) => i);
  if (items.length > 0) {
    const answered = items.filter((i) => i.status !== 'unknown').length;
    blocks.push({
      kind: 'p',
      variant: 'meta',
      text: `自评覆盖：${answered}/${items.length} 项已明确（其余为"待确认"，不计入适配度）`,
    });
  }

  /* 硬约束 */
  blocks.push({ kind: 'h4', text: '硬约束（触发的边界 → 不可直接进入）' });
  const verdict = selfLook?.hardConstraintVerdict ?? null;
  if (verdict) {
    blocks.push({
      kind: 'p',
      variant: verdict.blocked ? 'warn' : 'meta',
      text: verdict.blocked
        ? {
            html: '已触发硬约束否决：<b>不可直接进入</b>（按 §6.4，关联机会最高只能"验证后进入"）',
            md: '已触发硬约束否决：**不可直接进入**（按 §6.4，关联机会最高只能"验证后进入"）',
          }
        : '未触发硬约束否决（没有决策边界/约束项为"不具备"），但仍需人工拍板才能进入',
    });
    const notes = (verdict.notes ?? []).filter((n) => s(n));
    blocks.push({ kind: 'ul', items: notes.length ? notes : [NP] });
  } else {
    blocks.push({ kind: 'p', text: '未提供（看自己还没有生成硬约束结论：决策边界尚未评估）' });
    blocks.push({
      kind: 'p',
      variant: 'meta',
      text: '口径：硬约束触发 = 自评里"决策边界/约束"类出现"不具备"，或背景库/品类选择题判定为否决 → 结论只能是"验证后进入"，**不可直接进入**。',
    });
  }
  const derived = hardConstraintsFromSelfAssessment(items);
  blocks.push({
    kind: 'kv',
    rows: [
      {
        label: '自评推导的边界警戒（仅供复核）',
        value: derived.notes.length ? derived.notes.join('；') : NP,
      },
      { label: '四看摘要里的硬约束', value: orNp(input.fourLook?.hardConstraint, '未触发') },
    ],
  });
  return blocks;
}

/* ────────────────────────── §6 机会结论（机会卡 + 决策包 + Go/No-Go） ────────────────────────── */

function renderCardBlocks(card: OpportunityCard, index: number): Block[] {
  const blocks: Block[] = [];
  const pkg = card.decisionPackage;

  blocks.push({ kind: 'h3', text: `#O${index + 1} ${orNp(card.title, '未命名机会')}` });
  blocks.push({
    kind: 'p',
    variant: 'meta',
    text: `类型：${OPPORTUNITY_KIND_LABELS[card.kind ?? 'new_product'] ?? NP} ｜ 可信度：${
      CONFIDENCE_LABELS[card.confidence ?? 'low'] ?? NP
    } ｜ 状态：${card.status === 'confirmed' ? '已确认（人工）' : 'AI 候选（待确认）'} ｜ 决策：${
      CARD_DECISION_LABELS[card.decision ?? 'undecided'] ?? NP
    }`,
  });
  if (card.enterMode === 'validate_first') {
    blocks.push({
      kind: 'p',
      variant: 'warn',
      text: '硬约束未通过：本机会最高只能"验证后进入"，不得推荐"直接进入"。',
    });
  }

  blocks.push({
    kind: 'kv',
    rows: [
      { label: '需求', value: orNp(card.needStatement) },
      { label: '目标人群', value: orNp(card.targetUser) },
      { label: '场景', value: orNp(card.scenario) },
      { label: 'JTBD', value: orNp(card.jobToBeDone) },
      { label: '产品假设', value: orNp(card.solutionHypothesis) },
      { label: '当前替代方案', value: orNp(card.currentAlternative) },
      {
        label: '利润假设',
        value: card.profitAssumption
          ? `售价 ${money(card.profitAssumption.price)} / 采购 ${money(card.profitAssumption.cost)} / CPC ${money(
              card.profitAssumption.cpc
            )}`
          : '未提供（建议用侧栏利润计算器精算）',
      },
    ],
  });

  /* 评分拆解（五维 + 覆盖度） */
  blocks.push({ kind: 'sub', text: '评分拆解（确定性公式，AI 不参与）' });
  const b = card.scoreBreakdown;
  if (b) {
    const rows: Text[][] = (Object.keys(SCORE_WEIGHTS) as ScoreDimension[]).map((d) => [
      SCORE_DIMENSION_LABELS[d],
      String(SCORE_WEIGHTS[d]),
      { html: `<span class="mono">${bar(b[d])}</span>`, md: String(b[d]) },
    ]);
    rows.push([
      { html: '<b>综合分</b>', md: '**综合分**' },
      '100',
      { html: `<span class="mono"><b>${bar(b.total)}</b></span>`, md: `**${b.total}**` },
    ]);
    blocks.push({ kind: 'table', head: ['维度', '权重', '得分'], rows });
  } else {
    blocks.push({
      kind: 'p',
      text: `未提供评分拆解（综合分 ${num(card.score)}／数据覆盖度 ${pct(card.coverage)}）`,
    });
  }
  blocks.push({
    kind: 'p',
    variant: 'meta',
    text: `数据覆盖度（独立展示，不进 100 分）：${pct(card.coverage)}`,
  });

  /* 证据引用 */
  blocks.push({ kind: 'sub', text: '证据（可追溯）' });
  const refs = (card.evidenceRefs ?? []).filter((e) => e);
  if (refs.length > 0) {
    blocks.push({
      kind: 'ul',
      items: refs.map((e) => ({
        html: `<span class="mono">${escapeHtml(e.sourceRef || e.evidenceId)}</span> — ${escapeHtml(e.summary)}`,
        md: `\`${s(e.sourceRef) || s(e.evidenceId) || NP}\` — ${orNp(e.summary)}`,
      })),
    });
  } else {
    blocks.push({ kind: 'p', variant: 'meta', text: '未提供证据引用' });
  }

  /* 推理 / 反证 / 缺的证据 */
  const steps = (card.reasoningSteps ?? []).filter((x) => x);
  if (steps.length > 0) {
    blocks.push({ kind: 'sub', text: '推理' });
    blocks.push({
      kind: 'ol',
      items: steps.map((x) => ({
        html: `<b>${escapeHtml(orNp(x.step))}</b>：${escapeHtml(orNp(x.detail))}`,
        md: `**${orNp(x.step)}**：${orNp(x.detail)}`,
      })),
    });
  }
  const counter = (card.counterEvidence ?? []).filter((x) => s(x));
  if (counter.length > 0) {
    blocks.push({ kind: 'sub', text: '反证（可能推翻本机会）' });
    blocks.push({ kind: 'ul', items: counter });
  }
  const missing = (card.missingEvidence ?? []).filter((x) => s(x));
  if (missing.length > 0) {
    blocks.push({ kind: 'sub', text: '还缺的证据' });
    blocks.push({ kind: 'ul', items: missing });
  }

  /* 决策包：路线图 / 前置资源 / 控制点 */
  blocks.push({ kind: 'sub', text: '执行路线图' });
  const roadmap = (pkg?.roadmap ?? []).filter((a) => a);
  if (roadmap.length > 0) {
    for (const phase of ['now', 'next'] as const) {
      const list = roadmap.filter((a) => a.phase === phase);
      if (list.length === 0) continue;
      blocks.push({ kind: 'sub', text: ROADMAP_PHASE_LABELS[phase] });
      blocks.push({
        kind: 'ul',
        items: list.map((a) =>
          typeof a.cost === 'number'
            ? `${orNp(a.action)}（成本约 ${money(a.cost)}）${s(a.note) ? ` — ${s(a.note)}` : ''}`
            : `${orNp(a.action)}${s(a.note) ? ` — ${s(a.note)}` : ''}`
        ),
      });
    }
  } else {
    blocks.push({ kind: 'p', variant: 'meta', text: '未提供路线图' });
  }

  blocks.push({ kind: 'sub', text: '前置资源（含已知缺口）' });
  const resources = (pkg?.resources ?? []).filter((r) => r);
  if (resources.length > 0) {
    blocks.push({
      kind: 'ul',
      items: resources.map((r) => {
        const gapHtml = r.knownGap ? '<span class="gap">[缺口]</span> ' : '';
        const gapMd = r.knownGap ? '**[缺口]** ' : '';
        const body = `${RESOURCE_CATEGORY_LABELS[r.category] ?? NP}｜${orNp(r.label)}${s(r.note) ? `（${s(r.note)}）` : ''}`;
        return { html: `${gapHtml}${escapeHtml(body)}`, md: `${gapMd}${body}` };
      }),
    });
  } else {
    blocks.push({ kind: 'p', variant: 'meta', text: '未提供资源清单' });
  }

  blocks.push({ kind: 'sub', text: '控制点（三类：准入 / 过程 / 止损）' });
  const controlPoints = (pkg?.controlPoints ?? []).filter((c) => c);
  if (controlPoints.length > 0) {
    for (const kind of ['entry', 'process', 'stop'] as const) {
      const list = controlPoints.filter((c) => c.kind === kind);
      if (list.length === 0) continue;
      blocks.push({ kind: 'sub', text: CONTROL_POINT_LABELS[kind] });
      blocks.push({
        kind: 'ul',
        items: list.map((c) => {
          const body = `${orNp(c.label)}：${orNp(c.metric)} ${orNp(c.threshold)}`;
          const pending = c.confirmed ? '' : '（待确认）';
          return {
            html: `${c.confirmed ? '☑' : '☐'} ${escapeHtml(body)}${c.confirmed ? '' : ' <span class="warn">（待确认）</span>'}`,
            md: `${c.confirmed ? '[x]' : '[ ]'} ${body}${pending}`,
          };
        }),
      });
    }
  } else {
    blocks.push({ kind: 'p', variant: 'meta', text: '未提供控制点' });
  }

  const risks = (card.risks ?? []).filter((r) => r);
  if (risks.length > 0) {
    blocks.push({ kind: 'sub', text: '风险' });
    blocks.push({
      kind: 'ul',
      items: risks.map(
        (r) => `[${orNp(r.severity)}] ${orNp(r.label)}${s(r.mitigation) ? `（缓解：${s(r.mitigation)}）` : ''}`
      ),
    });
  }
  const validations = (card.validationActions ?? []).filter((v) => v);
  if (validations.length > 0) {
    blocks.push({ kind: 'sub', text: '验证动作' });
    blocks.push({
      kind: 'ul',
      items: validations.map(
        (v) =>
          `${orNp(v.action)} ｜ owner：${orNp(v.owner, '未指定')} ｜ 截止：${orNp(v.dueDate, '未指定')} ｜ 成功标准：${orNp(
            v.successCriteria,
            '未指定'
          )}`
      ),
    });
  }

  return blocks;
}

function section6(input: OpportunityReportInput, cards: OpportunityCard[]): Block[] {
  const blocks: Block[] = [];
  const decision = input.decision;
  const decided = cards.filter((c) => c.decision !== 'undecided').length;

  blocks.push({ kind: 'p', variant: 'headline', text: `机会卡 ${cards.length} 张（已拍板 ${decided} 张）` });
  if (cards.length === 0) {
    blocks.push({
      kind: 'p',
      text: '没有机会卡（零机会本身就是要评审的结论，见下方 Go / No-Go 汇总）。',
    });
  } else {
    cards.forEach((c, i) => blocks.push(...renderCardBlocks(c, i)));
  }

  blocks.push({ kind: 'h4', text: 'Go / No-Go 汇总与下一步' });
  blocks.push({
    kind: 'p',
    variant: 'headline',
    text: headlineWithStatus(orNp(decision?.headline), PROJECT_DECISION_LABELS[decision?.status] ?? NP),
  });
  const reasons = (Array.isArray(decision?.reasons) ? decision!.reasons : []).filter((r) => s(r));
  blocks.push({ kind: 'ul', items: reasons.length ? reasons : [NP] });
  blocks.push({ kind: 'p', text: `下一步：${orNp(decision?.nextAction)}` });

  const countBy = (d: OpportunityDecision) => cards.filter((c) => c.decision === d).length;
  blocks.push({
    kind: 'kv',
    rows: [
      { label: '机会卡总数', value: num(cards.length) },
      { label: '已拍板', value: num(decision?.decidedCount) },
      {
        label: '进入 / 验证后进入 / 暂缓 / 放弃 / 未拍板',
        value: `${num(countBy('enter'))} / ${num(countBy('validate_first'))} / ${num(countBy('hold'))} / ${num(
          countBy('reject')
        )} / ${num(countBy('undecided'))}`,
      },
      { label: '硬约束是否否决', value: decision?.hardBlocked ? '是（不可直接进入）' : '否' },
    ],
  });

  const conclusion = input.conclusion;
  if (conclusion) {
    blocks.push({ kind: 'sub', text: '零机会结论（也是结论，需要拍板）' });
    blocks.push({
      kind: 'p',
      text: `${NO_OPPORTUNITY_LABELS[conclusion.kind] ?? NP} ｜ ${orNp(conclusion.reason)}｜${
        conclusion.confirmed ? '已人工确认' : '待人工确认'
      }`,
    });
    const missing = (conclusion.missingData ?? []).filter((m) => s(m));
    blocks.push({ kind: 'ul', items: missing.length ? missing.map((m) => `缺：${s(m)}`) : [NP] });
  } else {
    blocks.push({ kind: 'p', variant: 'meta', text: '零机会结论：未提供（还没有做过零机会判定）' });
  }
  return blocks;
}

/* ────────────────────────── §7 证据索引与口径 ────────────────────────── */

function section7(input: OpportunityReportInput, cards: OpportunityCard[]): Block[] {
  const blocks: Block[] = [];
  const evidence = (Array.isArray(input.evidence) ? input.evidence : []).filter((e) => e && typeof e.id === 'string');

  blocks.push({ kind: 'h4', text: '证据索引（项目全部 Evidence，按来源编号）' });
  if (evidence.length === 0) {
    blocks.push({ kind: 'p', text: '未提供（项目里还没有 Evidence 记录：先在四看里「捕获为项目证据」）' });
  } else {
    blocks.push({
      kind: 'table',
      head: ['序号', '哪一看', '类型', 'sourceRef', '摘要', '时间'],
      rows: evidence.map((e, i) => [
        `#${i + 1}`,
        EVIDENCE_LOOK_LABELS[e.look] ?? NP,
        EVIDENCE_TYPE_LABELS[e.type] ?? NP,
        s(e.sourceRef) || NP,
        s(e.summary) || NP,
        isoTime(e.createdAt),
      ]),
    });
    const byLook = countEvidenceByLook(evidence);
    blocks.push({
      kind: 'p',
      variant: 'meta',
      text: `合计 ${evidence.length} 条 ｜ 看用户 ${byLook.user} ｜ 看市场 ${byLook.market} ｜ 看竞对 ${byLook.competitor} ｜ 看自己 ${byLook.self} ｜ 看机会 ${byLook.opportunity}`,
    });
  }
  blocks.push({
    kind: 'p',
    variant: 'meta',
    text: '编号口径：序号 #N = 本项目 Evidence 的展示顺序；sourceRef 是可定位回原始来源的引用串（如 kw:表#12 / review:B0XXX#34 / chart:价格带@细分 / asin:B0XXX）。机会卡上的"证据（可追溯）"逐条指向这里的 sourceRef。',
  });

  /* 口径 */
  blocks.push({ kind: 'h4', text: '口径（评分公式 / AI 与人工的分工）' });
  const weights = (Object.keys(SCORE_WEIGHTS) as ScoreDimension[])
    .map((d) => `${SCORE_DIMENSION_LABELS[d]} ${SCORE_WEIGHTS[d]}`)
    .join(' / ');
  blocks.push({
    kind: 'ul',
    items: [
      `评分公式（确定性，AI 不参与）：${weights}（满分 100；某一维没有输入时从分母移除，并相应降低数据覆盖度，不虚高也不虚低）。`,
      '数据覆盖度独立展示，不进 100 分。',
      'AI 只解释、不改分：AI 生成的候选卡，其评分/覆盖度/状态/决策一律由确定性逻辑重算（AI 自报的 status/decision 会被忽略，回到"AI 候选 + 未拍板"）。',
      `缺数据的字段一律写"${NP}"；三列对比里没抓到的 listing 字段写"${NF}"；不编造数字、ASIN 与评论原文。`,
      '细分机会分 = 趋势 35% + 体量 35% + 竞争 30%（segmentScore 固定权重）。',
      '适配度 = 相关题均分 × 背景库完整度（"待确认"不计入分母），与"完成度"分离。',
      '赢的路径判定顺序：人无我有 → 人有我优 → 人优我廉 → 无赢面（三条都不成立必须落到"无赢面"）。',
      '零机会是合法结论（已判断无机会 / 证据不足），但零机会结论本身需要人工确认。',
    ],
  });

  /* AI 判断 vs 人工确认 */
  blocks.push({ kind: 'h4', text: '哪些结论是 AI 判断、哪些经人工确认' });
  const isHuman = (c: OpportunityCard) => c.status === 'confirmed' && c.decision !== 'undecided';
  const human = cards.filter(isHuman);
  const aiOnly = cards.filter((c) => !isHuman(c));
  blocks.push({ kind: 'sub', text: `经人工确认的结论（${human.length} 张卡）` });
  blocks.push({
    kind: 'ul',
    items: human.length
      ? human.map((c) => `#O${cards.indexOf(c) + 1} ${orNp(c.title)} ｜ 状态：已确认 ｜ 决策：${CARD_DECISION_LABELS[c.decision] ?? NP}`)
      : [NP],
  });
  blocks.push({ kind: 'sub', text: `AI 判断、尚未人工确认的结论（${aiOnly.length} 张卡）` });
  blocks.push({
    kind: 'ul',
    items: aiOnly.length
      ? aiOnly.map(
          (c) =>
            `#O${cards.indexOf(c) + 1} ${orNp(c.title)} ｜ 状态：${c.status === 'confirmed' ? '已确认' : 'AI 候选（待确认）'} ｜ 决策：${
              CARD_DECISION_LABELS[c.decision] ?? NP
            }`
        )
      : [NP],
  });
  blocks.push({
    kind: 'p',
    variant: 'meta',
    text: `判定口径：只有 status='confirmed' 且 decision≠'undecided' 的卡才计为"经人工确认"；其余（含已确认但未拍板）一律按 AI 判断展示。零机会结论：${
      input.conclusion ? (input.conclusion.confirmed ? '已人工确认' : '待人工确认') : NP
    }。`,
  });
  return blocks;
}

/* ────────────────────────── 组装完整文档（§1-§7 顺序即线框图 §8 固定叙事） ────────────────────────── */

function buildReportDoc(input: OpportunityReportInput): ReportDoc {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const cards = (Array.isArray(input.cards) ? input.cards : []).filter((c) => c);
  const evidence = (Array.isArray(input.evidence) ? input.evidence : []).filter((e) => e && typeof e.id === 'string');
  const project = input.project ?? ({} as ResearchProject);

  return {
    title: `${orNp(project.name, '未命名项目')} · 选品决策审核报告`,
    meta: [`站点 ${orNp(project.marketplace)} ｜ 生成时间 ${now}`],
    conclusion: conclusionBlocks(input, cards, evidence),
    sections: [
      { num: 1, title: '研究目标', blocks: section1(input) },
      { num: 2, title: '用户需求', blocks: section2(input) },
      { num: 3, title: '市场细分', blocks: section3(input) },
      { num: 4, title: '竞品缺口', blocks: section4(input) },
      { num: 5, title: '自身适配', blocks: section5(input) },
      { num: 6, title: '机会结论', blocks: section6(input, cards) },
      { num: 7, title: '证据索引与口径', blocks: section7(input, cards) },
    ],
  };
}

/** 纯函数：整份报告的 HTML（无 IO，便于测试） */
export function buildOpportunityReportHtml(input: OpportunityReportInput): string {
  const doc = buildReportDoc(input);
  const body = [
    `<h1>${escapeHtml(doc.title)}</h1>`,
    ...doc.meta.map((m) => `<p class="meta">${escapeHtml(m)}</p>`),
    renderBlocksHtml(doc.conclusion),
    ...doc.sections.map((sec) => `<h2>§${sec.num} ${escapeHtml(sec.title)}</h2>\n${renderBlocksHtml(sec.blocks)}`),
    '<footer>Kairo · 亚马逊市场调研与选品决策 · 本文件可离线打开；固定叙事：研究目标 → 用户需求 → 市场细分 → 竞品缺口 → 自身适配 → 机会结论 → 证据索引。评分与控制点口径见配套 PRD §6.5 / §8.1。</footer>',
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(doc.title)}</title>
<style>
  body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6;color:#1d1d1f;max-width:1040px;margin:0 auto;padding:32px 20px;background:#fff}
  h1{font-size:24px;margin:0 0 4px}
  h2{font-size:18px;margin:32px 0 8px;padding-bottom:6px;border-bottom:2px solid #eef0ff}
  h3{font-size:16px;margin:22px 0 6px}
  h4{font-size:14px;margin:18px 0 6px;color:#374151}
  .meta{color:#6b7280;font-size:12px}
  .headline{font-size:17px;font-weight:700;color:#4338ca}
  .warn{color:#b45309;font-size:12px}
  .gap{color:#b91c1c;font-weight:700;font-size:12px}
  .phase{font-size:13px;font-weight:700;color:#4b5563;margin:10px 0 2px}
  table.kv{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0}
  table.kv th{text-align:left;width:30%;color:#6b7280;font-weight:600;vertical-align:top;padding:3px 8px 3px 0}
  table.kv td{padding:3px 0}
  table.grid{width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0}
  table.grid th{text-align:left;background:#f6f7ff;color:#374151;font-weight:600;padding:6px 8px;border:1px solid #e5e7eb;vertical-align:top}
  table.grid td{padding:6px 8px;border:1px solid #e9eaf3;vertical-align:top}
  .mono{font-family:ui-monospace,Consolas,monospace}
  ul,ol{margin:4px 0 8px 20px;padding:0}
  li{margin:2px 0;font-size:13px}
  footer{margin-top:32px;color:#9ca3af;font-size:12px;border-top:1px solid #eef0ff;padding-top:10px}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * M5 · Markdown 审核件（PRD §11.2：导出补 MD；**不做 PPT**）。
 * 与 HTML 版同源同口径（同一份 ReportDoc）：七个章节、顺序、标题与内容逐块对应。
 */
export function buildOpportunityMarkdownReport(input: OpportunityReportInput): string {
  const doc = buildReportDoc(input);
  const lines: string[] = [];

  lines.push(`# ${doc.title}`);
  lines.push('');
  for (const m of doc.meta) lines.push(`> ${m}`);
  lines.push('');
  lines.push(...renderBlocksMd(doc.conclusion));

  for (const sec of doc.sections) {
    lines.push(`## §${sec.num} ${sec.title}`);
    lines.push('');
    lines.push(...renderBlocksMd(sec.blocks));
  }

  lines.push('_Kairo · 亚马逊市场调研与选品决策 · 固定叙事：§1 研究目标 → §2 用户需求 → §3 市场细分 → §4 竞品缺口 → §5 自身适配 → §6 机会结论 → §7 证据索引与口径；口径见 PRD §6.5 / §8.1_');
  return lines.join('\n');
}

/* ────────────────────────── IO 层（读项目数据 → 填满 §1-§7） ────────────────────────── */

/** 组装四看摘要（人话，用于报告头部与 §1） */
async function buildFourLookSummary(
  userId: string,
  project: ResearchProject
): Promise<OpportunityReportInput['fourLook']> {
  const [userLook, market, comp, self] = await Promise.all([
    loadUserLook(userId, project.id),
    loadMarketLook(userId, project.id),
    loadCompetitorLook(userId, project.id),
    loadSelfAssessment(userId, project.id),
  ]);
  const needs = userLook.unmetNeedCandidates ?? [];
  const unmet = needs.filter((n) => (n.needStatement || '').trim()).length;
  return {
    user: `${unmet} 条未满足需求（目标用户：${userLook.targetUser || '未填写'}）`,
    market: market.attractiveness ? market.attractiveness.slice(0, 200) : `${market.keyEvidences.filter(Boolean).length} 条关键证据（未写吸引力判断）`,
    competitor: `${(comp.samplePool ?? []).filter(Boolean).length} 个竞对样本；缺口 ${comp.gaps.filter(Boolean).length} 条`,
    self: self.aiDraft?.conclusion || `自评 ${self.items.filter((i) => i.status !== 'unknown').length} 项已明确`,
    hardConstraint: self.hardConstraintVerdict?.blocked
      ? `已否决：${(self.hardConstraintVerdict.notes ?? []).join('；')}`
      : '未触发',
  };
}

/**
 * 读齐 §1-§7 需要的四看明细（全部是已落库数据 + 确定性计算的产物，AI 不参与）。
 * 竞对三列与赢的路径的取数口径与「看竞对」深潜页（CompetitorDeepDive）**完全一致**：同样的池子、
 * 同样的挑选规则、同样的矩阵与判定函数 —— 导出件与界面不会给出两个答案。
 */
async function collectReportData(userId: string, project: ResearchProject): Promise<Partial<OpportunityReportInput>> {
  const [snap, userLook, marketLook, competitorLook, selfLook, evidence] = await Promise.all([
    loadSnapshot(userId, project.id),
    loadUserLook(userId, project.id),
    loadMarketLook(userId, project.id),
    loadCompetitorLook(userId, project.id),
    loadSelfAssessment(userId, project.id),
    loadEvidence(userId, project.id),
  ]);

  const products = snap?.products ?? [];
  const history = snap?.history ?? [];
  const reviews = snap?.reviews ?? [];
  const needs = (userLook.unmetNeedCandidates ?? []).filter((n) => n && s(n.needStatement));

  const segmentSchemes = products.length > 0 ? synthesizeSegmentSchemes({ products, history, needs }) : [];
  const segmentContext = await loadMarketSegmentContext(userId, project.id, needs);

  // 1) 竞对池：优先用户在看市场选定的目标细分，其次全部样本（与 CompetitorDeepDive 同规则）
  let pool = products;
  const chosenSchemeId = marketLook.segmentSchemeId;
  const chosenSegmentIds = marketLook.chosenSegmentIds ?? [];
  if (chosenSchemeId && chosenSegmentIds.length > 0 && segmentSchemes.length > 0) {
    const scheme = segmentSchemes.find((sc) => sc.id === chosenSchemeId);
    const targets = scheme?.segments.filter((sg) => chosenSegmentIds.includes(sg.id)) ?? [];
    const asinSet = new Set(targets.flatMap((t) => t.asins));
    const sub = products.filter((p) => asinSet.has(p.asin));
    if (sub.length > 0) pool = sub;
  }

  // 2) 三列：竞对样本池优先，空则按确定性规则自动挑
  const detail = pool.length > 0 ? pickCompetitorsDetailed(pool) : { picked: [], notes: [] };
  const poolAsins = (competitorLook.samplePool ?? []).map((x) => s(x)).filter(Boolean);
  const columns = poolAsins.length > 0 ? poolAsins : detail.picked.map((p) => p.asin);
  const competitorRoles = detail.picked
    .filter((p) => columns.includes(p.asin))
    .map((p) => ({ asin: p.asin, role: p.role, reason: p.reason, note: p.note }));

  // 3) 三列对比 + 覆盖率（没抓到的字段显式标"未抓取"）
  const listingComparison =
    columns.length > 0
      ? buildComparisonTable({ asins: columns, products, history, listing: competitorLook.listingDetails, traffic: competitorLook.trafficDetails })
      : null;

  // 4) 每竞对三块分析
  const painMatrices = columns.map((a) => buildPainMatrix(a, reviews, needs));
  const satisfactionMatrices = columns.map((a) =>
    buildSatisfactionMatrix(a, products.find((p) => p.asin === a), reviews, needs, competitorLook.listingDetails?.[a])
  );
  const personas = columns.map((a) => buildCompetitorPersona(a, reviews, needs));

  // 5) 自身能力 + 赢的路径（确定性；没有竞对列时不做判定，报告里写"未提供"而不是假装"无赢面"）
  const capability = buildOurCapability({
    items: selfLook.items,
    byNeedId: competitorLook.ourCapabilityByNeedId ?? {},
    financials: competitorLook.ourCapabilityFinancials,
  });
  const winningPath =
    columns.length > 0
      ? decideWinningPath({
          needs,
          competitors: columns.map((a) => ({ asin: a, price: products.find((p) => p.asin === a)?.price })),
          matrices: satisfactionMatrices,
          ours: capability,
          priceReference: {
            lowestCompetitorPrice: Math.min(
              ...columns.map((a) => Number(products.find((p) => p.asin === a)?.price) || Number.POSITIVE_INFINITY)
            ),
          },
        })
      : null;

  // 6) 适配度（与看自己同一条确定性口径）
  const fitRaw = computeFitScore({
    answers: selfLook.quiz ? toAnswersForFit(selfLook.quiz) : {},
    backgroundCompleteness: computeCompleteness(loadCapabilityLibrary(userId)).completeness,
  });

  return {
    userLook,
    marketLook,
    competitorLook,
    selfLook,
    segmentSchemes,
    segmentContext,
    competitorRoles,
    listingComparison,
    painMatrices,
    satisfactionMatrices,
    personas,
    winningPath,
    fitScore: {
      fitScore: fitRaw.fitScore,
      answered: fitRaw.answered,
      excluded: fitRaw.excluded,
      backgroundCompleteness: fitRaw.backgroundCompleteness,
      note: fitRaw.note,
    },
    evidence,
    sample: {
      products: products.length,
      reviews: reviews.length,
      keywords: (snap?.keywords ?? []).length,
      competitors: columns.length,
    },
  };
}

/** IO 版：读数据 → 生成 HTML */
export async function buildOpportunityHtmlReport(userId: string, project: ResearchProject): Promise<string> {
  const [cards, conclusion, decision, fourLook, extras] = await Promise.all([
    loadOpportunities(userId, project.id),
    loadOpportunityConclusion(userId, project.id),
    loadProjectDecisionSummary(userId, project),
    buildFourLookSummary(userId, project),
    collectReportData(userId, project),
  ]);
  return buildOpportunityReportHtml({ project, cards, conclusion, decision, fourLook, ...extras });
}

/** IO 版：读数据 → 生成 Markdown（与 HTML 同源同口径） */
export async function buildOpportunityMarkdownReportForProject(userId: string, project: ResearchProject): Promise<string> {
  const [cards, conclusion, decision, fourLook, extras] = await Promise.all([
    loadOpportunities(userId, project.id),
    loadOpportunityConclusion(userId, project.id),
    loadProjectDecisionSummary(userId, project),
    buildFourLookSummary(userId, project),
    collectReportData(userId, project),
  ]);
  return buildOpportunityMarkdownReport({ project, cards, conclusion, decision, fourLook, ...extras });
}

/** 触发浏览器下载（HTML 审核件） */
export function downloadHtmlReport(html: string, fileName: string): void {
  downloadTextFile(html, fileName, 'text/html;charset=utf-8', '.html');
}

/** 触发浏览器下载（通用文本文件） */
export function downloadTextFile(text: string, fileName: string, mime: string, ext: string): void {
  const safe = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'report';
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe.endsWith(ext) ? safe : `${safe}${ext}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 触发浏览器下载（MD 审核件） */
export function downloadMarkdownReport(markdown: string, fileName: string): void {
  downloadTextFile(markdown, fileName, 'text/markdown;charset=utf-8', '.md');
}
