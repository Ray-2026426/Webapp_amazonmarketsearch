import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Upload, Sparkles, Loader2, MessageSquare, ThumbsUp, ThumbsDown, MapPin, Users as UsersIcon, Search, X, ChevronLeft, ChevronRight, ChevronDown, TrendingUp, FileText, Heart, Route, SlidersHorizontal, Languages, Pencil } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import {
  parseReviewsWithMapping,
  scanReviewFile,
  type Product,
  type Review,
} from '../utils/parser';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { fetchReviewsFromMcp } from '../utils/sellerspriteApi';
import { McpFetchPanel } from './McpFetchPanel';
import { getPrompt } from './AiPromptManager';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SecondaryReportPage } from './SecondaryReportPage';
import { InsightReportPanels, tryParseAiInsight } from './InsightReportPanels';
import type { AiInsight } from './KeywordAnalysis';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend, PieChart, Pie } from 'recharts';
import { Select } from './ui/Select';
import { FeishuPushButton } from './FeishuPushButton';
import { vocReportToMarkdown } from '../utils/reportToMarkdown';
import type { UserInsightsWorkspaceState } from '../utils/userInsightsHistory';

interface TagLibrary {
  positive: string[];
  negative: string[];
  scenarios: string[];
  audience: string[];
}

interface UserInsightsProps {
  products: Product[];
  reviews: Review[];
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>;
  persona: { people: string; scenarios: string; needs: string } | null;
  setPersona: React.Dispatch<React.SetStateAction<{ people: string; scenarios: string; needs: string } | null>>;
  /** 为 false 时不挂载 Recharts，避免父级 `hidden` 下图表与 React DOM 冲突（insertBefore 报错）。App 传 `activeView === 'insights'`。 */
  insightsUiActive?: boolean;
  /** 当前市场站点，用于在线抓取默认值 */
  marketplaceCode?: string;
  /** 示例数据预置的 VOC 深度报告（HTML 或 Markdown） */
  initialDeepReport?: string | null;
  /** 当前用户洞察工作区状态：用于刷新/重新登录后恢复 AI 结论 */
  workspaceFromParent?: UserInsightsWorkspaceState | null;
  /** 从历史或 IndexedDB 恢复时递增，强制把父级状态灌入本组件 */
  workspaceRestoreKey?: number;
  restorePayload?: UserInsightsWorkspaceState | null;
  /** 把深度洞察/旅程表同步给 App，由 App 写入 IndexedDB/保存数据 */
  onWorkspaceSync?: (state: UserInsightsWorkspaceState) => void;
}

const COLORS = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f59e0b','#10b981','#06b6d4','#3b82f6','#84cc16','#f97316'];

const PAGE_SIZE = 10;

interface JourneyRow {
  stage: string;
  who: string;
  where: string;
  when: string;
  what: string;
  why: string;
  how: string;
  quote: string;
  weakness: string;
  improvement: string;
}

const JOURNEY_MAX_ROWS = 80;
const JOURNEY_RAW_MAX_LEN = 350_000;

/** 每个维度标签库最多保留条数（与 AI 提示、解析一致） */
const TAG_LIB_MAX_PER_DIM = 6;

/** 去掉 AI 用 ``` 包裹的表格外壳，便于解析 */
function stripMarkdownFence(raw: string): string {
  let t = raw.trim();
  if (!t.startsWith('```')) return t;
  t = t.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
  t = t.replace(/\n?```\s*$/, '');
  return t.trim();
}

/** 深度报告：把「一、xxx」类章节行提升为 Markdown 标题，层次更清晰 */
function enhanceInsightReportMarkdown(text: string): string {
  const t = text.trim();
  return t.replace(/^([一二三四五六七八九十]+[、．.]\s*[^\n#]+)$/gm, (line) => {
    if (/^\s*#+\s/.test(line)) return line;
    return `## ${line}`;
  });
}

/** 抽取 AI 返回中第一段 JSON 对象 / 数组（用于旅程表 JSON 模式解析） */
function extractFirstJsonBlock(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === inStr) { inStr = null; }
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch as '"' | "'"; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 将 AI 返回解析为旅程行：先尝试 JSON，再回退到 TSV / Markdown 表 */
function parseJourneyRowsFlexible(raw: string): JourneyRow[] {
  const cleaned = stripMarkdownFence(typeof raw === 'string' ? raw : '');
  const jsonText = extractFirstJsonBlock(cleaned);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown[] }).rows))
          ? (parsed as { rows: unknown[] }).rows
          : null;
      if (list && list.length > 0) {
        const rows: JourneyRow[] = [];
        for (const item of list) {
          if (!item || typeof item !== 'object') continue;
          const o = item as Record<string, unknown>;
          const pick = (...keys: string[]) =>
            String(keys.map((k) => o[k]).find((v) => v != null) ?? '').trim();
          const row: JourneyRow = {
            stage: pick('stage', '阶段', '用户旅程阶段'),
            who: pick('who', 'Who'),
            where: pick('where', 'Where'),
            when: pick('when', 'When'),
            what: pick('what', 'What'),
            why: pick('why', 'Why'),
            how: pick('how', 'How'),
            quote: pick('quote', '原句', '代表评论原句'),
            weakness: pick('weakness', '劣势', '当前方案劣势'),
            improvement: pick('improvement', '改进', '改进方案', '可能的改进方案'),
          };
          if (row.stage) rows.push(row);
          if (rows.length >= JOURNEY_MAX_ROWS) break;
        }
        if (rows.length > 0) return rows;
      }
    } catch {
      /* fallback */
    }
  }
  return parseJourneyRows(cleaned);
}

/** 拆表格行：制表符 或 Markdown 表格（保留空单元格；兼容无尾部 | 的行，避免误删最后一列） */
function splitJourneyTableLine(line: string): string[] {
  const t = line.trim();
  if (!t) return [];
  if (t.startsWith('|')) {
    const parts = line.split('|').map((c) => c.trim());
    let start = 0;
    let end = parts.length;
    if (start < end && parts[start] === '') start++;
    if (end > start && parts[end - 1] === '') end--;
    return parts.slice(start, end);
  }
  return line.split('\t').map((c) => c.trim());
}

/**
 * 将单元格数组规整为 10 列。当「代表原句」里含制表符时，列数会 >10，
 * 此时把中间段合并为 quote，最后两列固定为劣势 / 改进方案。
 */
function journeyCellsToRow(cells: string[]): JourneyRow | null {
  if (cells.length < 9) return null;
  if (cells.every((c) => /^[\s\-:|]+$/.test(String(c)))) return null;
  if (String(cells[0] ?? '').includes('用户旅程阶段')) return null;

  let stage: string;
  let who: string;
  let where: string;
  let when: string;
  let what: string;
  let why: string;
  let how: string;
  let quote: string;
  let weakness: string;
  let improvement: string;

  if (cells.length === 10) {
    [stage, who, where, when, what, why, how, quote, weakness, improvement] = cells.map(String);
  } else if (cells.length > 10) {
    stage = String(cells[0]);
    who = String(cells[1]);
    where = String(cells[2]);
    when = String(cells[3]);
    what = String(cells[4]);
    why = String(cells[5]);
    how = String(cells[6]);
    improvement = String(cells[cells.length - 1] ?? '');
    weakness = String(cells[cells.length - 2] ?? '');
    quote = cells
      .slice(7, cells.length - 2)
      .map(String)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } else {
    stage = String(cells[0]);
    who = String(cells[1]);
    where = String(cells[2]);
    when = String(cells[3]);
    what = String(cells[4]);
    why = String(cells[5]);
    how = String(cells[6]);
    quote = String(cells[7] ?? '');
    weakness = String(cells[8] ?? '');
    improvement = '';
  }

  return repairJourneyRowMisplacedQuote({ stage, who, where, when, what, why, how, quote, weakness, improvement });
}

/** 若「改进方案」格子里其实是长评论、「原句」很短，则挪回 quote（常见 AI/制表错位） */
function repairJourneyRowMisplacedQuote(row: JourneyRow): JourneyRow {
  const q = row.quote.trim();
  const imp = row.improvement.trim();
  if (imp.length < 28) return row;
  if (q.length >= imp.length && q.length > 40) return row;
  const looksLikeBuyerReview =
    /(I |We |My |The product|Amazon|star|⭐️|⭐|推荐|差评|好评|东西|质量|物流|包装|收到|购买|退货|退款|客服)/i.test(imp) ||
    (imp.length > 60 && /[。！？]{1,}/g.test(imp));
  const looksLikeSuggestionOnly =
    /^(建议|可|可以|应该|不妨|优化|改进|增加|减少|换成|采用|提供|加强)/.test(imp) && imp.length < 160;
  if ((looksLikeBuyerReview || !q) && !looksLikeSuggestionOnly) {
    const merged = [q, imp].filter(Boolean).join('\n\n').trim();
    return { ...row, quote: merged, improvement: '' };
  }
  return row;
}

const parseJourneyRows = (raw: string): JourneyRow[] => {
  const safeRaw = stripMarkdownFence(typeof raw === 'string' ? raw.slice(0, JOURNEY_RAW_MAX_LEN) : '');
  const lines = safeRaw.split('\n').map((l) => l.trim()).filter(Boolean);
  const tableLines = lines.filter((l) => {
    if (l.includes('\t')) return true;
    if (!l.includes('|')) return false;
    // 跳过分隔行 |---|---| 与仅含空白的管道行
    const cells = splitJourneyTableLine(l);
    if (cells.length && cells.every((c) => /^[\s\-:|]+$/.test(String(c)))) return false;
    return true;
  });
  const rows = tableLines
    .map((line) => splitJourneyTableLine(line))
    .map((cells) => journeyCellsToRow(cells))
    .filter((row): row is JourneyRow => row != null);

  return rows.slice(0, JOURNEY_MAX_ROWS);
};

const normalizeSnippet = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 将「代表评论原句」拆成多条：换行、分号、编号、竖线、项目符号 */
const QUOTE_LINES_MAX = 80;

const splitJourneyQuoteLines = (quote: string): string[] => {
  if (!quote?.trim()) return [];
  const para = quote.replace(/\r/g, '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];

  const splitNumbered = (s: string): string[] => {
    const pieces = s
      .split(/(?=\d+[\.\、\)])/g)
      .map((x) => x.replace(/^\d+[\.\、\)]\s*/, '').trim())
      .filter(Boolean);
    return pieces.length > 1 ? pieces : [s];
  };

  for (const chunk of para) {
    let segments = chunk.split(/[；;]/).map((p) => p.trim()).filter(Boolean);
    if (segments.length <= 1) segments = splitNumbered(chunk);

    for (const seg of segments) {
      const byPipe = seg.split(/\s*[|｜]\s+/).map((x) => x.trim()).filter(Boolean);
      if (byPipe.length > 1) {
        out.push(...byPipe);
        continue;
      }
      const bullets = seg.split(/\s*[•·]\s+/).map((x) => x.trim()).filter(Boolean);
      if (bullets.length > 1) out.push(...bullets);
      else out.push(seg);
    }
  }

  const seen = new Set<string>();
  const deduped = out.filter((x) => {
    if (seen.has(x)) return false;
    seen.add(x);
    return true;
  });
  return deduped.slice(0, QUOTE_LINES_MAX);
};

/** 用原句在「当前筛选后的评论池」里找最可能的一条，用于展示买家晒图 */
const QUOTE_MATCH_POOL_MAX = 2500;

function findReviewForQuoteLine(line: string, pool: Review[]): Review | null {
  const t = normalizeSnippet(line);
  if (t.length < 6) return null;
  const slice = pool.length > QUOTE_MATCH_POOL_MAX ? pool.slice(0, QUOTE_MATCH_POOL_MAX) : pool;
  for (const r of slice) {
    const c = normalizeSnippet(r.content || '');
    if (c.length >= 8 && (c.includes(t.slice(0, Math.min(50, t.length))) || t.includes(c.slice(0, Math.min(40, c.length))))) {
      return r;
    }
  }
  for (let n = Math.min(36, t.length); n >= 10; n -= 6) {
    const sub = t.slice(0, n);
    for (const r of slice) {
      if ((r.content || '').includes(sub)) return r;
    }
  }
  const titleNeedle = t.slice(0, 24);
  for (const r of slice) {
    if ((r.title || '').includes(titleNeedle) || titleNeedle.includes((r.title || '').slice(0, 16))) return r;
  }
  return null;
}

/** 从多行文本 / 逗号分隔解析标签列表（用于手动维护标签库） */
function parseTagLinesFromInput(text: string): string[] {
  const parts = text
    .split(/[\n,，、;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= TAG_LIB_MAX_PER_DIM) break;
  }
  return out;
}

export const UserInsights: React.FC<UserInsightsProps> = React.memo(({
  products,
  reviews,
  setReviews,
  persona,
  setPersona,
  insightsUiActive = true,
  marketplaceCode = 'US',
  initialDeepReport = null,
  workspaceFromParent = null,
  workspaceRestoreKey = 0,
  restorePayload = null,
  onWorkspaceSync,
}) => {
  // ── State ──────────────────────────────────────────────
  const [step, setStep] = useState<'idle'|'step1'|'step2'|'done'>('idle');
  const [stepProgress, setStepProgress] = useState('');
  const [tagLib, setTagLib] = useState<TagLibrary | null>(() => workspaceFromParent?.tagLib ?? null);
  const [deepReport, setDeepReport] = useState<string | null>(() => workspaceFromParent?.deepReport ?? initialDeepReport ?? null);
  const [deepInsight, setDeepInsight] = useState<AiInsight | null>(() =>
    workspaceFromParent?.deepInsight ?? (workspaceFromParent?.deepReport ? tryParseAiInsight(workspaceFromParent.deepReport) : initialDeepReport ? tryParseAiInsight(initialDeepReport) : null)
  );
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [deepReportOpen, setDeepReportOpen] = useState(false);
  const [journeyReportRaw, setJourneyReportRaw] = useState<string | null>(() => workspaceFromParent?.journeyReportRaw ?? null);
  const [journeyRows, setJourneyRows] = useState<JourneyRow[]>(() => workspaceFromParent?.journeyRows ?? []);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [isJourneyLoading, setIsJourneyLoading] = useState(false);
  /** 每成功拉取一次旅程数据 +1，强制整段旅程 UI 重挂载，避免与 Recharts 并发提交 DOM 时 insertBefore 崩溃 */
  const [journeyMountId, setJourneyMountId] = useState(0);
  const [listSearchTerm, setListSearchTerm] = useState('');
  const [listMediaOnly, setListMediaOnly] = useState(false);
  const [filterRating, setFilterRating] = useState<'all' | '1' | '2' | '3' | '4' | '5' | 'bad'>('all');
  const [filterAsin, setFilterAsin] = useState<string>('all');
  const [filterModel, setFilterModel] = useState<string>('all');
  const [filterMedia, setFilterMedia] = useState<'all' | 'media' | 'no_media'>('all');
  const [filterVp, setFilterVp] = useState<'all' | 'vp' | 'non_vp'>('all');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [filterDatePreset, setFilterDatePreset] = useState<'all' | '90' | '180' | '365'>('all');
  const [filterHelpfulMin, setFilterHelpfulMin] = useState<'all' | '1' | '5' | '10'>('all');
  const [sortBy, setSortBy] = useState<'helpful' | 'date'>('helpful');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [translatedMap, setTranslatedMap] = useState<Record<string, string>>({});
  const [translatedVisibleMap, setTranslatedVisibleMap] = useState<Record<string, boolean>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [mediaPreview, setMediaPreview] = useState<{ type: 'image' | 'video'; url: string } | null>(null);
  const [tagModal, setTagModal] = useState<{ tag: string; dim: 'positive' | 'negative' | 'scenarios' | 'audience' } | null>(null);
  /** 更多筛选 / 图表：按 VOC 四类标签过滤（可同时选多个维度，条件为「且」） */
  const [filterTagPositive, setFilterTagPositive] = useState<string | null>(null);
  const [filterTagNegative, setFilterTagNegative] = useState<string | null>(null);
  const [filterTagScenarios, setFilterTagScenarios] = useState<string | null>(null);
  const [filterTagAudience, setFilterTagAudience] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [trendTag, setTrendTag] = useState<string | null>(null);
  const [trendDim, setTrendDim] = useState<'positive'|'negative'|'scenarios'|'audience'>('negative');
  const [journeyViewMode, setJourneyViewMode] = useState<'timeline' | 'table'>('timeline');
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState({ pos: '', neg: '', sce: '', aud: '' });
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [journeyQuoteTr, setJourneyQuoteTr] = useState<Record<string, string>>({});
  const [journeyQuoteTrShow, setJourneyQuoteTrShow] = useState<Record<string, boolean>>({});
  const [journeyQuoteTrLoading, setJourneyQuoteTrLoading] = useState<string | null>(null);
  const journeyQuoteTrRef = useRef<Record<string, string>>({});
  journeyQuoteTrRef.current = journeyQuoteTr;
  const [expandedReviewIds, setExpandedReviewIds] = useState<Record<string, boolean>>({});
  const lastWorkspaceRestoreKey = useRef(0);

  useEffect(() => {
    if (!initialDeepReport) return;
    if (workspaceFromParent?.deepReport) return;
    setDeepReport(initialDeepReport);
    setDeepInsight(tryParseAiInsight(initialDeepReport));
  }, [initialDeepReport, workspaceFromParent?.deepReport]);

  const buildWorkspaceState = useCallback((savedAt = new Date().toISOString()): UserInsightsWorkspaceState => {
    const hasResult = Boolean(deepReport || journeyReportRaw || journeyRows.length > 0);
    return {
      tagLib,
      deepReport,
      deepInsight,
      journeyReportRaw,
      journeyRows,
      updatedAt: hasResult ? savedAt : '',
      hasResult,
    };
  }, [deepInsight, deepReport, journeyReportRaw, journeyRows, tagLib]);

  useEffect(() => {
    if (!onWorkspaceSync) return;
    onWorkspaceSync(buildWorkspaceState());
  }, [buildWorkspaceState, onWorkspaceSync]);

  useEffect(() => {
    if (!workspaceRestoreKey || workspaceRestoreKey === lastWorkspaceRestoreKey.current) return;
    lastWorkspaceRestoreKey.current = workspaceRestoreKey;
    const seed = restorePayload ?? workspaceFromParent;
    if (!seed) return;
    setTagLib(seed.tagLib ?? null);
    setDeepReport(seed.deepReport ?? null);
    setDeepInsight(seed.deepInsight ?? (seed.deepReport ? tryParseAiInsight(seed.deepReport) : null));
    setJourneyReportRaw(seed.journeyReportRaw ?? null);
    setJourneyRows(seed.journeyRows ?? []);
    setJourneyMountId((n) => n + 1);
  }, [restorePayload, workspaceFromParent, workspaceRestoreKey]);

  const deepReportHtml = useMemo(
    () => {
      if (!deepReport || deepInsight) return '';
      let html = deepReport.replace(/^```html?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
      if (!html.startsWith('<')) {
        const start = html.search(/<(div|section|article|table|h[1-6]|p|ul|ol)/i);
        if (start >= 0) html = html.slice(start);
      }
      return html.startsWith('<') ? html : '';
    },
    [deepReport, deepInsight]
  );

  // 保留 deepReportMarkdown 用于兼容（但如果 deepReportHtml 非空，优先用 HTML）
  const deepReportMarkdown = useMemo(
    () => {
      if (deepReportHtml) return '';
      return deepReport ? enhanceInsightReportMarkdown(deepReport) : '';
    },
    [deepReport, deepReportHtml]
  );

  // ── Derived ────────────────────────────────────────────
  const allAsins = useMemo(
    () => [...new Set(reviews.map((r) => (r.asin || '').trim()).filter(Boolean))],
    [reviews]
  );
  const allModels = useMemo(
    () => [...new Set(reviews.map((r) => (r.childAsin || '').trim()).filter(Boolean))],
    [reviews]
  );
  const allCountries = useMemo(() => {
    const set = new Set<string>();
    reviews.forEach((r) => set.add((r.country || '').trim() || '未知'));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [reviews]);

  /** 全量已打标评论中出现的标签（供筛选下拉，不受当前筛选影响） */
  const tagOptionsAll = useMemo(() => {
    const pos = new Set<string>();
    const neg = new Set<string>();
    const sce = new Set<string>();
    const aud = new Set<string>();
    reviews.forEach((r) => {
      if (!r.tags) return;
      r.tags.positive.forEach((t) => pos.add(t));
      r.tags.negative.forEach((t) => neg.add(t));
      r.tags.scenarios.forEach((t) => sce.add(t));
      r.tags.audience.forEach((t) => aud.add(t));
    });
    return {
      positive: [...pos].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      negative: [...neg].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      scenarios: [...sce].sort((a, b) => a.localeCompare(b, 'zh-CN')),
      audience: [...aud].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    };
  }, [reviews]);

  const filteredReviews = useMemo(() => {
    let r = reviews;
    if (filterRating === 'bad') r = r.filter((x) => x.rating > 0 && x.rating <= 3);
    else if (filterRating !== 'all') r = r.filter((x) => Math.round(x.rating) === Number(filterRating));
    if (filterAsin !== 'all') r = r.filter((x) => (x.asin || '').trim() === filterAsin);
    if (filterModel !== 'all') r = r.filter((x) => ((x.childAsin || '').trim() || '未知型号') === filterModel);
    if (filterMedia === 'media') r = r.filter((x) => Boolean(x.hasImage || x.hasVideo));
    if (filterMedia === 'no_media') r = r.filter((x) => !x.hasImage && !x.hasVideo);
    if (filterVp === 'vp') r = r.filter((x) => Boolean(x.isVp));
    if (filterVp === 'non_vp') r = r.filter((x) => !x.isVp);
    if (filterCountry !== 'all') {
      r = r.filter((x) => ((x.country || '').trim() || '未知') === filterCountry);
    }
    if (filterDatePreset !== 'all') {
      const days = parseInt(filterDatePreset, 10);
      const cutoff = Date.now() - days * 86400000;
      r = r.filter((x) => {
        const t = Date.parse(x.date || '');
        return Number.isFinite(t) && t >= cutoff;
      });
    }
    if (filterHelpfulMin !== 'all') {
      const m = parseInt(filterHelpfulMin, 10);
      r = r.filter((x) => (x.helpful || 0) >= m);
    }
    if (filterTagPositive) r = r.filter((x) => x.tags?.positive.includes(filterTagPositive));
    if (filterTagNegative) r = r.filter((x) => x.tags?.negative.includes(filterTagNegative));
    if (filterTagScenarios) r = r.filter((x) => x.tags?.scenarios.includes(filterTagScenarios));
    if (filterTagAudience) r = r.filter((x) => x.tags?.audience.includes(filterTagAudience));
    const sorted = [...r].sort((a, b) => {
      if (sortBy === 'helpful') return sortOrder === 'desc' ? b.helpful - a.helpful : a.helpful - b.helpful;
      const ta = Date.parse(a.date || '');
      const tb = Date.parse(b.date || '');
      const va = Number.isFinite(ta) ? ta : 0;
      const vb = Number.isFinite(tb) ? tb : 0;
      return sortOrder === 'desc' ? vb - va : va - vb;
    });
    return sorted;
  }, [reviews, filterRating, filterAsin, filterModel, filterMedia, filterVp, filterCountry, filterDatePreset, filterHelpfulMin, filterTagPositive, filterTagNegative, filterTagScenarios, filterTagAudience, sortBy, sortOrder]);

  /** 仅影响底部评论列表：正文搜索 + 仅图视频（与图表/KPI 的「更多筛选」分离） */
  const reviewsForList = useMemo(() => {
    let r = filteredReviews;
    if (listMediaOnly) r = r.filter((x) => Boolean(x.hasImage || x.hasVideo));
    if (listSearchTerm.trim()) {
      const q = listSearchTerm.toLowerCase();
      r = r.filter((x) => x.title.toLowerCase().includes(q) || (x.content || '').toLowerCase().includes(q));
    }
    return r;
  }, [filteredReviews, listMediaOnly, listSearchTerm]);

  const tagStats = useMemo(() => {
    const stats = { positive:{} as Record<string,number>, negative:{} as Record<string,number>, scenarios:{} as Record<string,number>, audience:{} as Record<string,number> };
    filteredReviews.forEach(r => {
      if (!r.tags) return;
      r.tags.positive.forEach(t => stats.positive[t] = (stats.positive[t]||0)+1);
      r.tags.negative.forEach(t => stats.negative[t] = (stats.negative[t]||0)+1);
      r.tags.scenarios.forEach(t => stats.scenarios[t] = (stats.scenarios[t]||0)+1);
      r.tags.audience.forEach(t => stats.audience[t] = (stats.audience[t]||0)+1);
    });
    const top = (obj: Record<string,number>, n=8) => Object.entries(obj).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value).slice(0,n);
    return { positive: top(stats.positive), negative: top(stats.negative), scenarios: top(stats.scenarios), audience: top(stats.audience) };
  }, [filteredReviews]);

  const trendData = useMemo(() => {
    if (!trendTag) return [];
    const byMonth: Record<string, number> = {};
    filteredReviews.forEach((r) => {
      if (!r.tags?.[trendDim]?.includes(trendTag)) return;
      const m = r.date ? r.date.substring(0, 7) : '未知';
      byMonth[m] = (byMonth[m] || 0) + 1;
    });
    return Object.entries(byMonth)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, count }));
  }, [filteredReviews, trendTag, trendDim]);

  /** 当前维度下 TOP 标签 × 月份，用于多条折线对比 */
  const multiTagMonthlyTrend = useMemo(() => {
    const topNames = tagStats[trendDim].slice(0, 8).map((t) => t.name);
    if (topNames.length === 0) return { months: [] as string[], rows: [] as Record<string, string | number>[], topNames: [] as string[] };
    const topSet = new Set(topNames);
    const byMonthTag: Record<string, Record<string, number>> = {};
    filteredReviews.forEach((r) => {
      const month = r.date ? r.date.substring(0, 7) : '未知';
      const dimTags = r.tags?.[trendDim];
      if (!dimTags?.length) return;
      if (!byMonthTag[month]) byMonthTag[month] = {};
      for (const tag of dimTags) {
        if (!topSet.has(tag)) continue;
        const m = byMonthTag[month]!;
        m[tag] = (m[tag] || 0) + 1;
      }
    });
    const months = Object.keys(byMonthTag).sort((a, b) => a.localeCompare(b));
    const rows = months.map((month) => {
      const row: Record<string, string | number> = { month };
      const counts = byMonthTag[month]!;
      for (const tag of topNames) row[tag] = counts[tag] || 0;
      return row;
    });
    return { months, rows, topNames };
  }, [filteredReviews, tagStats, trendDim]);

  /** 选中标签在各国家的提及次数（随筛选条件变化） */
  const countryDistForTag = useMemo(() => {
    if (!trendTag) return [];
    const byCountry: Record<string, number> = {};
    filteredReviews.forEach((r) => {
      if (!r.tags?.[trendDim]?.includes(trendTag)) return;
      const c = (r.country || '').trim() || '未知';
      byCountry[c] = (byCountry[c] || 0) + 1;
    });
    return Object.entries(byCountry)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
  }, [filteredReviews, trendTag, trendDim]);

  /** 饼图：取 Top 国家 +「其他」，避免扇区过多难读；数据仍随顶部筛选与单标签条件变化 */
  const countryPieData = useMemo(() => {
    if (!countryDistForTag.length) return [];
    const maxSlice = 12;
    const top = countryDistForTag.slice(0, maxSlice);
    const sumTop = top.reduce((s, d) => s + d.value, 0);
    const sumAll = countryDistForTag.reduce((s, d) => s + d.value, 0);
    const rest = sumAll - sumTop;
    if (rest > 0 && countryDistForTag.length > maxSlice) {
      return [...top.map((d) => ({ name: d.name, value: d.value })), { name: '其他', value: rest }];
    }
    return top.map((d) => ({ name: d.name, value: d.value }));
  }, [countryDistForTag]);

  const filterActiveCount = useMemo(() => {
    let n = 0;
    if (filterRating !== 'all') n++;
    if (filterAsin !== 'all') n++;
    if (filterModel !== 'all') n++;
    if (filterMedia !== 'all') n++;
    if (filterVp !== 'all') n++;
    if (filterCountry !== 'all') n++;
    if (filterDatePreset !== 'all') n++;
    if (filterHelpfulMin !== 'all') n++;
    if (filterTagPositive) n++;
    if (filterTagNegative) n++;
    if (filterTagScenarios) n++;
    if (filterTagAudience) n++;
    return n;
  }, [filterRating, filterAsin, filterModel, filterMedia, filterVp, filterCountry, filterDatePreset, filterHelpfulMin, filterTagPositive, filterTagNegative, filterTagScenarios, filterTagAudience]);

  const resetFilters = useCallback(() => {
    setFilterTagPositive(null);
    setFilterTagNegative(null);
    setFilterTagScenarios(null);
    setFilterTagAudience(null);
    setFilterRating('all');
    setFilterAsin('all');
    setFilterModel('all');
    setFilterMedia('all');
    setFilterVp('all');
    setFilterCountry('all');
    setFilterDatePreset('all');
    setFilterHelpfulMin('all');
    setTagModal(null);
    setPage(1);
  }, []);

  const resetListOnlyFilters = useCallback(() => {
    setListSearchTerm('');
    setListMediaOnly(false);
    setPage(1);
  }, []);

  const pagedReviews = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return reviewsForList.slice(start, start + PAGE_SIZE);
  }, [reviewsForList, page]);
  const totalPages = Math.max(1, Math.ceil(reviewsForList.length / PAGE_SIZE));

  useEffect(() => {
    setPage((p) => Math.min(p, Math.max(1, Math.ceil(reviewsForList.length / PAGE_SIZE) || 1)));
  }, [reviewsForList.length]);

  const kpi = useMemo(() => {
    const total = filteredReviews.length;
    const asinCount: Record<string, number> = {};
    filteredReviews.forEach((r) => {
      const key = (r.asin || '').trim();
      if (!key) return;
      asinCount[key] = (asinCount[key] || 0) + 1;
    });
    const topAsin = Object.entries(asinCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const topAsinReviews = topAsin ? filteredReviews.filter((r) => (r.asin || '').trim() === topAsin && Number(r.rating) > 0) : [];
    const topAsinReviewAvg = topAsinReviews.length > 0
      ? topAsinReviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / topAsinReviews.length
      : 0;
    const topProductRating = topAsin ? (products.find((p) => p.asin === topAsin)?.rating || 0) : 0;
    const fallbackAvg = total > 0 ? filteredReviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / total : 0;
    const avgRating = topAsinReviewAvg > 0 ? topAsinReviewAvg : (topProductRating > 0 ? topProductRating : fallbackAvg);
    const highQualityCount = filteredReviews.filter((r) => Boolean(r.hasImage || r.hasVideo)).length;
    const badCount = filteredReviews.filter((r) => r.rating > 0 && r.rating <= 3).length;
    return {
      total,
      avgRating,
      highQualityCount,
      highQualityRate: total > 0 ? (highQualityCount / total) * 100 : 0,
      badCount,
      badRate: total > 0 ? (badCount / total) * 100 : 0,
    };
  }, [filteredReviews, products]);

  /** 导入/抓取新评论后，清空下游分析结果与筛选，避免旧标签串味 */
  const resetInsightDerivedState = () => {
    setTagLib(null);
    setDeepReport(null);
    setDeepReportOpen(false);
    setJourneyReportRaw(null);
    setJourneyRows([]);
    setFilterRating('all');
    setFilterAsin('all');
    setFilterModel('all');
    setFilterMedia('all');
    setFilterVp('all');
    setFilterCountry('all');
    setFilterDatePreset('all');
    setFilterHelpfulMin('all');
    setFilterTagPositive(null);
    setFilterTagNegative(null);
    setFilterTagScenarios(null);
    setFilterTagAudience(null);
    setListSearchTerm('');
    setListMediaOnly(false);
    setExpandedReviewIds({});
    setTranslatedMap({});
    setTranslatedVisibleMap({});
    setTagModal(null);
    setJourneyQuoteTr({});
    setJourneyQuoteTrShow({});
    setTagEditorOpen(false);
    setStep('idle');
  };

  // ── File Upload ────────────────────────────────────────
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const scan = await scanReviewFile(file);
      const r = await parseReviewsWithMapping(file, scan.mapping);
      setReviews(r);
      resetInsightDerivedState();
      toast.success(`成功导入 ${r.length} 条评论`);
    }
    catch { toast.error('解析评论失败，请检查文件格式'); }
    e.target.value = '';
  };

  const handleMcpFetchReviews = async (params: {
    asins: string[];
    marketplace: string;
    maxPages: number;
    replace: boolean;
    onProgress: (msg: string) => void;
  }) => {
    const all: Review[] = [];
    for (let i = 0; i < params.asins.length; i++) {
      const asin = params.asins[i];
      params.onProgress(`(${i + 1}/${params.asins.length}) 抓取 ${asin}…`);
      const chunk = await fetchReviewsFromMcp({
        asin,
        marketplace: params.marketplace,
        maxPages: params.maxPages,
        onProgress: params.onProgress,
      });
      all.push(...chunk);
    }
    if (!all.length) {
      toast.error('未抓到评论，请换 ASIN/站点或减少筛选后重试');
      throw new Error('未抓到评论');
    }
    setReviews((prev) => (params.replace ? all : [...prev, ...all]));
    resetInsightDerivedState();
    toast.success(`已从卖家精灵抓取 ${all.length} 条评论（${params.asins.length} 个 ASIN）`);
  };

  // ── Step 1: Generate Tag Library ───────────────────────
  const runStep1 = useCallback(async () => {
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) { toast.error('请先在「AI 设置」中配置 API Key'); return; }
    setStep('step1'); setStepProgress('正在生成标签库...');
    try {
      const sample = [...reviews].sort((a,b)=>b.helpful-a.helpful).slice(0, 120);
      const reviewText = sample.map(r => `标题: ${r.title}\n内容: ${r.content}`).join('\n---\n');
      const basePrompt = getPrompt('voc_tag_generate');
      const prompt = `${basePrompt}\n\n## 评论数据\n${reviewText}`;
      const res = await generateText(prompt, aiSettings, { jsonMode: true });
      const raw = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] ?? res) as Record<string, unknown>;
      const asArr = (x: unknown): string[] =>
        Array.isArray(x) ? x.map((s) => String(s).trim()).filter(Boolean).slice(0, TAG_LIB_MAX_PER_DIM) : [];
      const lib: TagLibrary = {
        positive: asArr(raw.positive),
        negative: asArr(raw.negative),
        scenarios: asArr(raw.scenarios),
        audience: asArr(raw.audience),
      };
      setTagLib(lib);
      setStep('done');
      setStepProgress('');
      toast.success(
        `标签库生成完成！好评 ${lib.positive.length} · 差评 ${lib.negative.length} · 场景 ${lib.scenarios.length} · 人群 ${lib.audience.length}`
      );
      return lib;
    } catch(e: any) {
      toast.error('Step1 失败: ' + e.message); setStep('idle'); return null;
    }
  }, [reviews]);

  // ── Step 2: Label All Reviews ──────────────────────────
  const runStep2 = useCallback(async (lib: TagLibrary) => {
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) return;
    const tagCount = lib.positive.length + lib.negative.length + lib.scenarios.length + lib.audience.length;
    if (tagCount === 0) {
      toast.error('标签库为空，请先填写或生成至少一个标签');
      return;
    }
    setStep('step2');
    const tagListStr = `好评点: ${lib.positive.join(', ')}\n差评点: ${lib.negative.join(', ')}\n使用场景: ${lib.scenarios.join(', ')}\n目标人群: ${lib.audience.join(', ')}`;
    const basePrompt = getPrompt('voc_tag_label');
    /** 略增大批次 + 有限并发，减少往返次数；不修改 prompt 正文 */
    const BATCH = 32;
    const CONCURRENCY = 3;
    const processed = [...reviews];
    const total = reviews.length;
    const batches: { start: number; slice: Review[] }[] = [];
    for (let i = 0; i < total; i += BATCH) {
      batches.push({ start: i, slice: reviews.slice(i, i + BATCH) });
    }

    const runOneBatch = async (start: number, batch: Review[]) => {
      const prompt = `${basePrompt}\n\n【标签项列表】\n${tagListStr}\n\n【用户评论列表】\n${batch.map((r, idx) => `[ID:${start + idx}] 标题:${r.title} 内容:${r.content.slice(0, 200)}`).join('\n')}`;
      const res = await generateText(prompt, aiSettings, { jsonMode: true });
      const json = JSON.parse(res.match(/\{[\s\S]*\}/)?.[0] ?? res);
      json.tags?.forEach((t: { id: number | string; positive?: string[]; negative?: string[]; scenarios?: string[]; audience?: string[] }) => {
        const id = typeof t.id === 'string' ? parseInt(t.id, 10) : t.id;
        if (!Number.isFinite(id) || id < 0 || id >= processed.length) return;
        const cur = processed[id];
        if (!cur) return;
        processed[id] = {
          ...cur,
          tags: {
            positive: t.positive || [],
            negative: t.negative || [],
            scenarios: t.scenarios || [],
            audience: t.audience || [],
          },
        };
      });
    };

    let doneCount = 0;
    for (let w = 0; w < batches.length; w += CONCURRENCY) {
      const chunk = batches.slice(w, w + CONCURRENCY);
      const results = await Promise.allSettled(chunk.map(({ start, slice }) => runOneBatch(start, slice)));
      results.forEach((r, idx) => {
        if (r.status === 'rejected') console.error('batch error', r.reason);
        doneCount += chunk[idx]!.slice.length;
      });
      setStepProgress(`正在打标 ${Math.min(doneCount, total)} / ${total} 条...`);
    }
    setReviews(processed);
    setStep('done');
    setStepProgress('');
    toast.success('打标完成！');
  }, [reviews, setReviews]);

  const runStep1AndSave = async () => {
    const lib = await runStep1();
    if (lib) setTagLib(lib);
  };

  // ── Deep Report ────────────────────────────────────────
  const runDeepReport = async () => {
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) { toast.error('请先配置 API Key'); return; }
    setIsReportLoading(true);
    try {
      const sample = filteredReviews.slice(0, 80);
      const reviewText = sample.map(r => `[${r.rating}星] ${r.title}: ${r.content.slice(0,150)}`).join('\n');
      const tagSummary = tagLib ? `\n\n高频标签汇总：\n好评: ${tagLib.positive.join(', ')}\n差评: ${tagLib.negative.join(', ')}\n场景: ${tagLib.scenarios.join(', ')}\n人群: ${tagLib.audience.join(', ')}` : '';
      const basePrompt = getPrompt('voc_deep_report');
      const prompt = `${basePrompt}\n\n## 评论数据（共${filteredReviews.length}条，样本${sample.length}条）${tagSummary}\n\n${reviewText}`;
      const res = await generateText(prompt, aiSettings, { jsonMode: true });
      const parsed = tryParseAiInsight(res);
      setDeepReport(res);
      setDeepInsight(parsed);
      setDeepReportOpen(true);
      if (!parsed) toast.warning('已生成内容，但未解析为结构化报告。请到「设置 → Prompt」将「VOC Step3」重置为默认后再试。');
      else toast.success('深度洞察报告已生成');
    } catch(e: any) { toast.error('生成报告失败: ' + e.message); }
    setIsReportLoading(false);
  };

  const openTagEditor = useCallback((from: TagLibrary | null) => {
    if (from) {
      setTagDraft({
        pos: from.positive.join('\n'),
        neg: from.negative.join('\n'),
        sce: from.scenarios.join('\n'),
        aud: from.audience.join('\n'),
      });
    } else {
      setTagDraft({ pos: '', neg: '', sce: '', aud: '' });
    }
    setTagEditorOpen(true);
  }, []);

  const applyTagDraft = useCallback(() => {
    const lib: TagLibrary = {
      positive: parseTagLinesFromInput(tagDraft.pos),
      negative: parseTagLinesFromInput(tagDraft.neg),
      scenarios: parseTagLinesFromInput(tagDraft.sce),
      audience: parseTagLinesFromInput(tagDraft.aud),
    };
    if (lib.positive.length + lib.negative.length + lib.scenarios.length + lib.audience.length === 0) {
      toast.error('请至少在一类里填写标签（可每行一个，或用逗号、顿号分隔）');
      return;
    }
    setTagLib(lib);
    setTagEditorOpen(false);
    toast.success('标签库已保存。可点击「Step2: 自动打标」按当前标签匹配评论。');
  }, [tagDraft]);

  const runJourneyReport = async () => {
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) { toast.error('请先配置 API Key'); return; }
    setIsJourneyLoading(true);
    try {
      const sampleCap = 100;
      const contentCap = 200;
      const sample = filteredReviews.slice(0, sampleCap);
      const reviewText = sample
        .map((r, i) => `[${i + 1}] [${r.rating}星] [${r.date || '未知日期'}] [ASIN:${r.asin || '未知'}] [国家:${r.country || '未知'}] 标题:${String(r.title).slice(0, 120)} 内容:${String(r.content || '').slice(0, contentCap)}`)
        .join('\n');
      const basePrompt = getPrompt('voc_user_journey_5w1h');
      const prompt = `${basePrompt}\n\n评论数据（共${filteredReviews.length}条，样本${sample.length}条）：\n${reviewText}`;
      const res = await generateText(prompt, aiSettings, { jsonMode: true });
      const trimmed = stripMarkdownFence(typeof res === 'string' ? res.slice(0, JOURNEY_RAW_MAX_LEN) : '');
      setJourneyQuoteTr({});
      setJourneyQuoteTrShow({});
      setJourneyReportRaw(trimmed);
      let rows: JourneyRow[] = [];
      try {
        rows = parseJourneyRowsFlexible(trimmed);
      } catch (err) {
        console.error('parseJourneyRowsFlexible', err);
        toast.error('解析旅程表格失败，可能是 AI 返回格式异常。已保留原文，可缩小筛选范围后重试。');
      }
      setJourneyRows(rows);
      setJourneyMountId((n) => n + 1);
      setJourneyOpen(true);
      if (rows.length === 0 && trimmed.length > 80) {
        toast.warning('AI 返回内容未能解析为旅程表，已展示原文。可缩小筛选范围或在 AI 设置中恢复「VOC Step4」默认提示后重试。');
      }
      else if (rows.length >= JOURNEY_MAX_ROWS) toast.info(`仅展示前 ${JOURNEY_MAX_ROWS} 行旅程，避免页面过载`);
    } catch (e: any) {
      toast.error('生成用户旅程失败: ' + e.message);
    } finally {
      window.setTimeout(() => setIsJourneyLoading(false), 0);
    }
  };

  const translateJourneyQuoteLine = async (key: string, text: string) => {
    if (journeyQuoteTrRef.current[key]) {
      setJourneyQuoteTrShow((prev) => ({ ...prev, [key]: !prev[key] }));
      return;
    }
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) {
      toast.error('请先配置 API Key');
      return;
    }
    setJourneyQuoteTrLoading(key);
    try {
      const prompt = `请把下面买家评论原句翻译成简体中文，保留原意，不要补充解释。\n\n${text}`;
      const res = await generateText(prompt, aiSettings);
      setJourneyQuoteTr((prev) => ({ ...prev, [key]: res.trim() }));
      setJourneyQuoteTrShow((prev) => ({ ...prev, [key]: true }));
    } catch (e: any) {
      toast.error('翻译失败: ' + e.message);
    } finally {
      setJourneyQuoteTrLoading(null);
    }
  };

  const translateReview = async (review: Review) => {
    if (translatedMap[review.id]) {
      setTranslatedVisibleMap((prev) => ({ ...prev, [review.id]: !prev[review.id] }));
      return;
    }
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) { toast.error('请先配置 API Key'); return; }
    setTranslatingId(review.id);
    try {
      const prompt = `请把下面评论翻译成简体中文，保留原意，不要补充解释。\n\n标题：${review.title}\n内容：${review.content}`;
      const res = await generateText(prompt, aiSettings);
      setTranslatedMap((prev) => ({ ...prev, [review.id]: res.trim() }));
      setTranslatedVisibleMap((prev) => ({ ...prev, [review.id]: true }));
    } catch (e: any) {
      toast.error('翻译失败: ' + e.message);
    } finally {
      setTranslatingId(null);
    }
  };

  /**
   * 点击柱状图：单维度独占（会清空另外三类标签筛选项），与下拉多选组合互斥于「最后一次操作为准」。
   * 再次点击同一根柱子则取消该维度并关闭弹窗。
   */
  /** 评论列表里点标签：只切换当前维度，不影响其它三类（可与下拉组合） */
  const toggleTagFilterOneDim = (tag: string, dim: 'positive' | 'negative' | 'scenarios' | 'audience') => {
    const isClear =
      (dim === 'positive' && filterTagPositive === tag) ||
      (dim === 'negative' && filterTagNegative === tag) ||
      (dim === 'scenarios' && filterTagScenarios === tag) ||
      (dim === 'audience' && filterTagAudience === tag);
    if (isClear) {
      if (dim === 'positive') setFilterTagPositive(null);
      if (dim === 'negative') setFilterTagNegative(null);
      if (dim === 'scenarios') setFilterTagScenarios(null);
      if (dim === 'audience') setFilterTagAudience(null);
      setTagModal((m) => (m?.tag === tag && m?.dim === dim ? null : m));
      setPage(1);
      return;
    }
    if (dim === 'positive') setFilterTagPositive(tag);
    if (dim === 'negative') setFilterTagNegative(tag);
    if (dim === 'scenarios') setFilterTagScenarios(tag);
    if (dim === 'audience') setFilterTagAudience(tag);
    setTagModal({ tag, dim });
    setPage(1);
  };

  const handleTagClick = (tag: string, dim: 'positive' | 'negative' | 'scenarios' | 'audience') => {
    const isClear =
      (dim === 'positive' && filterTagPositive === tag) ||
      (dim === 'negative' && filterTagNegative === tag) ||
      (dim === 'scenarios' && filterTagScenarios === tag) ||
      (dim === 'audience' && filterTagAudience === tag);
    if (isClear) {
      setFilterTagPositive((p) => (dim === 'positive' ? null : p));
      setFilterTagNegative((p) => (dim === 'negative' ? null : p));
      setFilterTagScenarios((p) => (dim === 'scenarios' ? null : p));
      setFilterTagAudience((p) => (dim === 'audience' ? null : p));
      setTagModal(null);
      setPage(1);
      return;
    }
    setFilterTagPositive((p) => (dim === 'positive' ? tag : null));
    setFilterTagNegative((p) => (dim === 'negative' ? tag : null));
    setFilterTagScenarios((p) => (dim === 'scenarios' ? tag : null));
    setFilterTagAudience((p) => (dim === 'audience' ? tag : null));
    setPage(1);
    setTagModal({ tag, dim });
  };

  const hasTagged = reviews.some(r => r.tags);
  /** 生成旅程表时暂时卸载 Recharts，避免与大量旅程节点同一提交周期内抢 DOM（常见 insertBefore NotFoundError） */
  const showInsightCharts = hasTagged && insightsUiActive && !isJourneyLoading;
  const isRunning = step === 'step1' || step === 'step2';
  const tagModalReviews = useMemo(() => {
    if (!tagModal) return [];
    return filteredReviews.filter((r) => r.tags?.[tagModal.dim]?.includes(tagModal.tag));
  }, [filteredReviews, tagModal]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-[24px] font-bold text-[#1d1d1f] tracking-tight">用户洞察</h2>
          <p className="text-[#86868b] text-sm mt-1">更深层看差评结构变化，并输出可落地的用户旅程洞察</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {reviews.length > 0 && <button onClick={() => { setReviews([]); setPersona(null); resetInsightDerivedState(); }} className="px-4 py-2 bg-white border border-black/5 rounded-xl text-sm font-medium text-[#86868b] hover:bg-rose-50 hover:text-rose-600 transition-all">清空数据</button>}
          <McpFetchPanel
            mode="reviews"
            defaultMarketplace={marketplaceCode}
            suggestAsins={products.slice(0, 8).map((p) => p.asin).filter(Boolean)}
            onFetch={handleMcpFetchReviews}
          />
          <label className="flex items-center gap-2 px-4 py-2 bg-white border border-black/5 rounded-xl text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] cursor-pointer shadow-sm">
            <Upload className="w-4 h-4" /> 上传评论文件
            <input type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFileUpload} />
          </label>
          {reviews.length > 0 && (
            <button onClick={runStep1AndSave} disabled={isRunning} className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-xl text-sm font-semibold hover:bg-indigo-50 disabled:opacity-60 shadow-sm">
              {step === 'step1' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
              {step === 'step1' ? stepProgress : 'Step1: AI智能分类'}
            </button>
          )}
          {reviews.length > 0 && (
            <button
              type="button"
              onClick={() => openTagEditor(tagLib)}
              disabled={isRunning}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-black/10 text-[#1d1d1f] rounded-xl text-sm font-semibold hover:bg-[#f5f5f7] disabled:opacity-60 shadow-sm"
            >
              <Pencil className="w-4 h-4 text-[#86868b]" />
              {tagLib ? '编辑 / 手动标签库' : '手动标签库（跳过 AI）'}
            </button>
          )}
          {tagLib && (
            <button onClick={() => runStep2(tagLib)} disabled={isRunning} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl text-sm font-semibold hover:from-indigo-700 hover:to-violet-700 disabled:opacity-60 shadow-md">
              {step === 'step2' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Sparkles className="w-4 h-4"/>}
              {step === 'step2' ? stepProgress : 'Step2: 自动打标'}
            </button>
          )}
        </div>
      </div>

      {reviews.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-black/10 p-20 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mb-6"><MessageSquare className="w-8 h-8 text-indigo-600"/></div>
          <h3 className="text-lg font-bold text-[#1d1d1f] mb-2">暂无评论数据</h3>
          <p className="text-[#86868b] max-w-sm">点右上角「在线抓取评论」填入竞品 ASIN 即可拉取；也可以继续上传 CSV / Excel。</p>
        </div>
      ) : (
        <>
          {/* 筛选：与图表/KPI 联动；正文搜索在底部「评论明细列表」 */}
          <div className="rounded-2xl border border-black/5 bg-[#fafafa] overflow-hidden">
            <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <p className="text-[11px] text-[#86868b] sm:max-w-md">以下筛选作用于上方 KPI、标签图与趋势。评论列表的搜索与「仅图/视频」在页面最下方单独设置。</p>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <button
                  type="button"
                  onClick={() => setFilterPanelOpen((v) => !v)}
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${filterPanelOpen ? 'border-indigo-200 bg-indigo-50 text-indigo-800' : 'border-black/5 bg-white text-[#1d1d1f] hover:bg-[#f5f5f7]'}`}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  更多筛选
                  {filterActiveCount > 0 ? (
                    <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white">{filterActiveCount}</span>
                  ) : null}
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${filterPanelOpen ? 'rotate-180' : ''}`} />
                </button>
                {filterActiveCount > 0 ? (
                  <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 rounded-xl border border-rose-100 bg-white px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50">
                    <X className="h-3 w-3" />
                    重置
                  </button>
                ) : null}
                <span className="text-xs text-[#6e6e73] sm:ml-1">分析范围 {filteredReviews.length} 条</span>
              </div>
            </div>
            {filterActiveCount > 0 && !filterPanelOpen ? (
              <div className="flex flex-wrap gap-1.5 border-t border-black/5 bg-white/80 px-3 py-2">
                {filterRating !== 'all' ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-[#424245]">
                    星级：{filterRating === 'bad' ? '差评(1–3星)' : `${filterRating}星`}
                  </span>
                ) : null}
                {filterAsin !== 'all' ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-[#424245]">ASIN：{filterAsin}</span> : null}
                {filterModel !== 'all' ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-[#424245]">型号：{filterModel}</span> : null}
                {filterMedia !== 'all' ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-[#424245]">{filterMedia === 'media' ? '仅带图/视频' : '无图无视频'}</span>
                ) : null}
                {filterVp !== 'all' ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-[#424245]">{filterVp === 'vp' ? '仅VP' : '非VP'}</span>
                ) : null}
                {filterCountry !== 'all' ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-[#424245]">国家：{filterCountry}</span>
                ) : null}
                {filterDatePreset !== 'all' ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-[#424245]">
                    时间：近 {filterDatePreset} 天
                  </span>
                ) : null}
                {filterHelpfulMin !== 'all' ? (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-[#424245]">有用 ≥{filterHelpfulMin}</span>
                ) : null}
                {filterTagPositive ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">好评：{filterTagPositive}</span>
                ) : null}
                {filterTagNegative ? (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-800">差评：{filterTagNegative}</span>
                ) : null}
                {filterTagScenarios ? (
                  <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-800">场景：{filterTagScenarios}</span>
                ) : null}
                {filterTagAudience ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">人群：{filterTagAudience}</span>
                ) : null}
              </div>
            ) : null}
            {filterPanelOpen ? (
              <div className="grid grid-cols-1 gap-3 border-t border-black/5 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#6e6e73]">星级</span>
                  <Select
                    value={filterRating}
                    onChange={(v) => {
                      setFilterRating(v as 'all' | '1' | '2' | '3' | '4' | '5' | 'bad');
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: '全部星级' },
                      { value: 'bad', label: '仅差评 (1–3 星)' },
                      { value: '1', label: '1 星' },
                      { value: '2', label: '2 星' },
                      { value: '3', label: '3 星' },
                      { value: '4', label: '4 星' },
                      { value: '5', label: '5 星' },
                    ]}
                    size="sm"
                    className="w-full"
                    aria-label="星级"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#6e6e73]">ASIN</span>
                  <Select
                    value={filterAsin}
                    onChange={(v) => {
                      setFilterAsin(v);
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: '全部 ASIN' },
                      ...allAsins.map((v) => ({ value: v, label: v })),
                    ]}
                    size="sm"
                    className="w-full"
                    aria-label="ASIN"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#6e6e73]">子体 / 型号</span>
                  <Select
                    value={filterModel}
                    onChange={(v) => {
                      setFilterModel(v);
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: '全部型号' },
                      ...allModels.map((v) => ({ value: v, label: v })),
                    ]}
                    size="sm"
                    className="w-full"
                    aria-label="子体型号"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#6e6e73]">图片 / 视频</span>
                  <Select
                    value={filterMedia}
                    onChange={(v) => {
                      setFilterMedia(v as 'all' | 'media' | 'no_media');
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: '不限' },
                      { value: 'media', label: '仅带图或视频' },
                      { value: 'no_media', label: '无图无视频' },
                    ]}
                    size="sm"
                    className="w-full"
                    aria-label="图片视频"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#6e6e73]">Verified Purchase</span>
                  <Select
                    value={filterVp}
                    onChange={(v) => {
                      setFilterVp(v as 'all' | 'vp' | 'non_vp');
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: '不限' },
                      { value: 'vp', label: '仅 VP' },
                      { value: 'non_vp', label: '非 VP' },
                    ]}
                    size="sm"
                    className="w-full"
                    aria-label="Verified Purchase"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#6e6e73]">国家 / 地区</span>
                  <Select
                    value={filterCountry}
                    onChange={(v) => {
                      setFilterCountry(v);
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: '全部国家' },
                      ...allCountries.map((c) => ({ value: c, label: c })),
                    ]}
                    size="sm"
                    className="w-full"
                    aria-label="国家地区"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#6e6e73]">评论时间</span>
                  <Select
                    value={filterDatePreset}
                    onChange={(v) => {
                      setFilterDatePreset(v as 'all' | '90' | '180' | '365');
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: '不限' },
                      { value: '90', label: '近 90 天' },
                      { value: '180', label: '近 180 天' },
                      { value: '365', label: '近 365 天' },
                    ]}
                    size="sm"
                    className="w-full"
                    aria-label="评论时间"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-[#6e6e73]">有用投票（点赞）</span>
                  <Select
                    value={filterHelpfulMin}
                    onChange={(v) => {
                      setFilterHelpfulMin(v as 'all' | '1' | '5' | '10');
                      setPage(1);
                    }}
                    options={[
                      { value: 'all', label: '不限' },
                      { value: '1', label: '至少 1' },
                      { value: '5', label: '至少 5' },
                      { value: '10', label: '至少 10' },
                    ]}
                    size="sm"
                    className="w-full"
                    aria-label="有用投票"
                  />
                </label>
                <div className="sm:col-span-2 lg:col-span-3 space-y-2">
                  <p className="text-[11px] font-semibold text-[#6e6e73]">VOC 标签（好评 / 差评 / 场景 / 人群）</p>
                  <p className="text-[10px] text-[#86868b]">四类可同时选择，列表结果需同时满足（且）。未完成打标时不可用。</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-emerald-800">好评点</span>
                      <Select
                        value={filterTagPositive ?? ''}
                        disabled={!hasTagged}
                        onChange={(v) => {
                          setFilterTagPositive(v || null);
                          setPage(1);
                        }}
                        options={[
                          { value: '', label: '不限' },
                          ...tagOptionsAll.positive.map((t) => ({ value: t, label: t })),
                        ]}
                        size="sm"
                        className="w-full"
                        aria-label="好评点"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-rose-800">差评点</span>
                      <Select
                        value={filterTagNegative ?? ''}
                        disabled={!hasTagged}
                        onChange={(v) => {
                          setFilterTagNegative(v || null);
                          setPage(1);
                        }}
                        options={[
                          { value: '', label: '不限' },
                          ...tagOptionsAll.negative.map((t) => ({ value: t, label: t })),
                        ]}
                        size="sm"
                        className="w-full"
                        aria-label="差评点"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-indigo-800">使用场景</span>
                      <Select
                        value={filterTagScenarios ?? ''}
                        disabled={!hasTagged}
                        onChange={(v) => {
                          setFilterTagScenarios(v || null);
                          setPage(1);
                        }}
                        options={[
                          { value: '', label: '不限' },
                          ...tagOptionsAll.scenarios.map((t) => ({ value: t, label: t })),
                        ]}
                        size="sm"
                        className="w-full"
                        aria-label="使用场景"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] font-semibold text-amber-900">目标人群</span>
                      <Select
                        value={filterTagAudience ?? ''}
                        disabled={!hasTagged}
                        onChange={(v) => {
                          setFilterTagAudience(v || null);
                          setPage(1);
                        }}
                        options={[
                          { value: '', label: '不限' },
                          ...tagOptionsAll.audience.map((t) => ({ value: t, label: t })),
                        ]}
                        size="sm"
                        className="w-full"
                        aria-label="目标人群"
                      />
                    </label>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {tagLib && (
            <Card className="rounded-2xl border-black/5 shadow-sm overflow-hidden">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 bg-[#f5f5f7]/60 border-b border-black/5">
                <CardTitle className="text-sm font-bold">当前标签库（可编辑）</CardTitle>
                <button
                  type="button"
                  onClick={() => openTagEditor(tagLib)}
                  className="inline-flex items-center gap-1 rounded-lg border border-black/5 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  修改标签
                </button>
              </CardHeader>
              <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-semibold text-[#86868b] mb-2">好评点</div>
                  <div className="flex flex-wrap gap-1.5">{tagLib.positive.map((t, idx) => <span key={`p_${idx}_${t}`} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full border border-emerald-100">{t}</span>)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#86868b] mb-2">差评点</div>
                  <div className="flex flex-wrap gap-1.5">{tagLib.negative.map((t, idx) => <span key={`n_${idx}_${t}`} className="px-2 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-bold rounded-full border border-rose-100">{t}</span>)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#86868b] mb-2">使用场景</div>
                  <div className="flex flex-wrap gap-1.5">{tagLib.scenarios.map((t, idx) => <span key={`s_${idx}_${t}`} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-full border border-indigo-100">{t}</span>)}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#86868b] mb-2">目标人群</div>
                  <div className="flex flex-wrap gap-1.5">{tagLib.audience.map((t, idx) => <span key={`a_${idx}_${t}`} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-100">{t}</span>)}</div>
                </div>
              </CardContent>
            </Card>
          )}

          {tagEditorOpen ? (
            <Card className="rounded-2xl border-indigo-100 shadow-sm overflow-hidden ring-1 ring-indigo-100">
              <CardHeader className="bg-indigo-50/80 border-b border-indigo-100">
                <CardTitle className="text-sm font-bold text-indigo-900">编辑标签库</CardTitle>
                <p className="text-xs text-indigo-800/80 mt-1">每类单独填写：可<strong>一行一个标签</strong>，或用<strong>中文/英文逗号、顿号</strong>分隔；<strong>每类最多 {TAG_LIB_MAX_PER_DIM} 个</strong>。应用后直接用下方「Step2: 自动打标」，无需再跑 Step1。</p>
              </CardHeader>
              <CardContent className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-emerald-800">好评点</span>
                  <textarea
                    value={tagDraft.pos}
                    onChange={(e) => setTagDraft((d) => ({ ...d, pos: e.target.value }))}
                    rows={5}
                    className="rounded-xl border border-black/10 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-y"
                    placeholder="例如：材质好&#10;安装简单"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-rose-800">差评点</span>
                  <textarea
                    value={tagDraft.neg}
                    onChange={(e) => setTagDraft((d) => ({ ...d, neg: e.target.value }))}
                    rows={5}
                    className="rounded-xl border border-black/10 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-y"
                    placeholder="例如：有异味、尺寸偏小"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-indigo-800">使用场景</span>
                  <textarea
                    value={tagDraft.sce}
                    onChange={(e) => setTagDraft((d) => ({ ...d, sce: e.target.value }))}
                    rows={5}
                    className="rounded-xl border border-black/10 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-y"
                    placeholder="例如：办公室、车载"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-amber-900">目标人群</span>
                  <textarea
                    value={tagDraft.aud}
                    onChange={(e) => setTagDraft((d) => ({ ...d, aud: e.target.value }))}
                    rows={5}
                    className="rounded-xl border border-black/10 bg-white p-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 resize-y"
                    placeholder="例如：新手妈妈、健身人群"
                  />
                </label>
                <div className="md:col-span-2 flex flex-wrap gap-2 justify-end">
                  <button type="button" onClick={() => setTagEditorOpen(false)} className="px-4 py-2 rounded-xl text-sm font-medium text-[#86868b] hover:bg-black/5">
                    取消
                  </button>
                  <button type="button" onClick={applyTagDraft} className="px-4 py-2 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700">
                    应用标签库
                  </button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* 模块一：KPI Widget */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="rounded-3xl border-none shadow-sm bg-white">
              <CardContent className="p-5">
                <p className="text-xs text-[#6e6e73]">总评论数</p>
                <p className="text-3xl font-semibold text-[#1d1d1f] mt-2">{kpi.total}</p>
              </CardContent>
            </Card>
            <Card className="rounded-3xl border-none shadow-sm bg-white">
              <CardContent className="p-5">
                <p className="text-xs text-[#6e6e73]">平均星级</p>
                <p className="text-3xl font-semibold text-[#1d1d1f] mt-2">{kpi.avgRating.toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card className="rounded-3xl border-none shadow-sm bg-white">
              <CardContent className="p-5">
                <p className="text-xs text-[#6e6e73]">高质量评论占比（图/视频）</p>
                <p className="text-3xl font-semibold text-[#1d1d1f] mt-2">{kpi.highQualityRate.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card className="rounded-3xl border-none shadow-sm bg-white">
              <CardContent className="p-5">
                <p className="text-xs text-[#6e6e73]">1-3星差评占比</p>
                <p className="text-3xl font-semibold text-[#d94141] mt-2">{kpi.badRate.toFixed(1)}%</p>
              </CardContent>
            </Card>
          </div>

          

          {/* Tag Charts - only show if tagged；仅在本 Tab 可见时挂载 Recharts，避免父级 `hidden` 下初始化图表 */}
          {showInsightCharts && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {([['positive','好评点',ThumbsUp,'#10b981'],['negative','差评点',ThumbsDown,'#f43f5e'],['scenarios','使用场景',MapPin,'#6366f1'],['audience','目标人群',UsersIcon,'#f59e0b']] as const).map(([dim, label, Icon, color]) => {
                const selTag =
                  dim === 'positive'
                    ? filterTagPositive
                    : dim === 'negative'
                      ? filterTagNegative
                      : dim === 'scenarios'
                        ? filterTagScenarios
                        : filterTagAudience;
                return (
                  <Card key={dim} className="rounded-3xl border-black/5 shadow-sm overflow-hidden">
                    <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5 pb-3">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4" style={{ color }} />
                        <CardTitle className="text-sm font-bold">{label}</CardTitle>
                        {selTag ? (
                          <span className="ml-auto px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[10px] font-semibold">筛选中: {selTag}</span>
                        ) : null}
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={tagStats[dim]} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                          <XAxis type="number" hide />
                          <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{ fill: '#f5f5f7' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                          <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={(d: any) => handleTagClick(d.name, dim)}>
                            {tagStats[dim].map((entry, i) => (
                              <Cell
                                key={i}
                                fill={selTag === entry.name ? '#4f46e5' : color}
                                opacity={selTag && selTag !== entry.name ? 0.3 : 1}
                                cursor="pointer"
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* 标签趋势：单标签 + TOP 多标签月度对比 + 国家分布 */}
          {showInsightCharts && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card className="rounded-3xl border-black/5 shadow-sm overflow-hidden">
                <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
                  <div className="flex items-center gap-3 flex-wrap">
                    <TrendingUp className="w-4 h-4 text-indigo-500 shrink-0" />
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-bold">单标签 · 按月趋势</CardTitle>
                      <p className="text-[11px] text-[#86868b] mt-0.5">与上方筛选联动，看某一标签随月份的变化</p>
                    </div>
                    <Select
                      value={trendDim}
                      onChange={(v) => {
                        setTrendDim(v as 'positive' | 'negative' | 'scenarios' | 'audience');
                        setTrendTag(null);
                      }}
                      options={[
                        { value: 'positive', label: '好评点' },
                        { value: 'negative', label: '差评点' },
                        { value: 'scenarios', label: '使用场景' },
                        { value: 'audience', label: '目标人群' },
                      ]}
                      size="sm"
                      className="ml-auto shrink-0"
                      aria-label="趋势维度"
                    />
                    <Select
                      value={trendTag ?? ''}
                      onChange={(v) => setTrendTag(v || null)}
                      options={[
                        { value: '', label: '选择标签' },
                        ...tagStats[trendDim].map((t) => ({ value: t.name, label: t.name })),
                      ]}
                      size="sm"
                      className="shrink-0 max-w-[200px]"
                      aria-label="趋势标签"
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-4 h-[280px]">
                  {trendTag && trendData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="month" fontSize={11} axisLine={false} tickLine={false} />
                        <YAxis fontSize={11} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                        <Line type="monotone" dataKey="count" name="提及次数" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-[#86868b] text-sm text-center px-4">
                      {trendTag ? '该标签在当前筛选下没有可解析月份的评论' : '请选择维度和标签查看趋势'}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-black/5 shadow-sm overflow-hidden">
                <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
                  <div className="flex items-center gap-3 flex-wrap">
                    <TrendingUp className="w-4 h-4 text-violet-500 shrink-0" />
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-bold">TOP 标签 · 月度对比</CardTitle>
                      <p className="text-[11px] text-[#86868b] mt-0.5">当前维度下出现最多的前 8 个标签，按月对比（无需再选标签）</p>
                    </div>
                    <Select
                      value={trendDim}
                      onChange={(v) => {
                        setTrendDim(v as 'positive' | 'negative' | 'scenarios' | 'audience');
                        setTrendTag(null);
                      }}
                      options={[
                        { value: 'positive', label: '好评点' },
                        { value: 'negative', label: '差评点' },
                        { value: 'scenarios', label: '使用场景' },
                        { value: 'audience', label: '目标人群' },
                      ]}
                      size="sm"
                      className="ml-auto shrink-0"
                      aria-label="对比维度"
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-4 h-[280px]">
                  {multiTagMonthlyTrend.rows.length > 0 && multiTagMonthlyTrend.topNames.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={multiTagMonthlyTrend.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey="month" fontSize={10} axisLine={false} tickLine={false} />
                        <YAxis fontSize={10} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                        <Legend wrapperStyle={{ fontSize: '11px' }} />
                        {multiTagMonthlyTrend.topNames.map((tag, i) => (
                          <Line key={`${i}-${tag || 'x'}`} type="monotone" dataKey={tag} name={tag} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-[#86868b] text-sm">暂无已打标数据或当前筛选下无标签</div>
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-black/5 shadow-sm overflow-hidden xl:col-span-2">
                <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
                  <div className="flex items-center gap-3 flex-wrap">
                    <MapPin className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div className="min-w-0">
                      <CardTitle className="text-sm font-bold">标签 · 国家/地区分布（饼图）</CardTitle>
                      <p className="text-[11px] text-[#86868b] mt-0.5">与顶部筛选、单标签选项联动；国家数过多时自动合并为「其他」</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-4 h-[340px]">
                  {trendTag && countryPieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={countryPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="46%"
                          innerRadius={0}
                          outerRadius={118}
                          paddingAngle={1}
                          label={(props: { name?: string; percent?: number }) => {
                            const pct = typeof props.percent === 'number' && !Number.isNaN(props.percent) ? props.percent * 100 : 0;
                            return `${String(props.name ?? '')} ${pct.toFixed(0)}%`;
                          }}
                        >
                          {countryPieData.map((_, i) => (
                            <Cell key={`${i}-${countryPieData[i]!.name}`} fill={COLORS[i % COLORS.length]} stroke="#fff" strokeWidth={1} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => [`${v} 条`, '评论']} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                        <Legend verticalAlign="bottom" height={28} wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-[#86868b] text-sm text-center px-4">
                      {trendTag ? '当前筛选下该标签没有国家字段或数量为 0' : '请先在「单标签 · 按月趋势」中选择一个标签'}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          <div className="space-y-6">
            <Card className="rounded-3xl border-black/5 shadow-sm overflow-hidden w-full">
              <CardHeader className="bg-gradient-to-r from-indigo-50 to-violet-50 border-b border-black/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 rounded-xl"><Sparkles className="w-4 h-4 text-indigo-600"/></div>
                    <div>
                      <CardTitle className="text-sm font-bold">AI 深度洞察报告</CardTitle>
                      <p className="text-xs text-[#86868b] mt-0.5">结构与关键词报告一致：用户画像 · 决策路径 · 洞察结论</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {deepReport && (
                      <button
                        type="button"
                        onClick={() => setDeepReportOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-xl text-sm font-semibold hover:bg-indigo-50"
                      >
                        <FileText className="w-4 h-4"/>
                        查看报告
                      </button>
                    )}
                    <button onClick={runDeepReport} disabled={isReportLoading} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
                      {isReportLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <FileText className="w-4 h-4"/>}
                      {isReportLoading ? '生成中...' : deepReport ? '重新生成' : '生成深度洞察'}
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <button
                  type="button"
                  onClick={() => {
                    if (deepReport) setDeepReportOpen(true);
                  }}
                  disabled={!deepReport}
                  className={`w-full min-h-[150px] rounded-2xl border border-dashed p-6 text-left transition-all ${
                    deepReport
                      ? 'border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 hover:border-indigo-300 cursor-pointer'
                      : 'border-black/10 bg-[#f8f9fb] cursor-default'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${deepReport ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-300 border border-black/5'}`}>
                        <FileText className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-[#1d1d1f] mb-1">
                          {deepReport ? '深度洞察报告已生成' : '尚未生成深度洞察报告'}
                        </div>
                        <p className="text-sm text-[#86868b] leading-relaxed max-w-2xl">
                          {deepReport
                            ? '点击此卡片进入完整报告页；一级页只保留入口，避免和详情页重复展示。'
                            : '点击右上角「生成深度洞察」，生成后这里会变成完整报告入口。'}
                        </p>
                      </div>
                    </div>
                    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold shrink-0 ${deepReport ? 'bg-white text-indigo-700 border border-indigo-200' : 'bg-white text-[#86868b] border border-black/5'}`}>
                      <FileText className="w-4 h-4" />
                      {deepReport ? '打开报告' : '等待生成'}
                    </div>
                  </div>
                </button>
              </CardContent>
            </Card>

            {deepReportOpen && deepReport && (
              <SecondaryReportPage
                title="AI 深度洞察报告"
                subtitle="用户画像 · 决策路径 · 洞察结论"
                icon={<Sparkles className="w-5 h-5" />}
                onClose={() => setDeepReportOpen(false)}
                onRegenerate={() => void runDeepReport()}
                regenerating={isReportLoading}
                extraActions={
                  <FeishuPushButton
                    compact
                    title="VOC 深度洞察报告"
                    getMarkdown={() =>
                      vocReportToMarkdown({
                        insight: deepInsight,
                        html: deepReportHtml || undefined,
                        markdown: deepReportMarkdown || undefined,
                        title: 'VOC 深度洞察报告',
                      })
                    }
                  />
                }
              >
                {deepInsight ? (
                  <InsightReportPanels ins={deepInsight} evidenceLabel="证据" />
                ) : deepReportHtml ? (
                  <div
                    className="text-[15px] leading-[1.8] text-[#3f3f46] [&_h1]:text-[22px] [&_h1]:font-semibold [&_h1]:text-indigo-950 [&_h1]:mb-4 [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:text-indigo-900 [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:mt-5 [&_h3]:mb-2 [&_p]:mb-3 [&_li]:mb-1.5"
                    dangerouslySetInnerHTML={{ __html: deepReportHtml }}
                  />
                ) : (
                  <div className="prose prose-base max-w-none text-[#3f3f46] leading-relaxed prose-headings:font-semibold prose-headings:text-indigo-950 prose-p:my-3">
                    <Markdown remarkPlugins={[remarkGfm]}>{deepReportMarkdown}</Markdown>
                  </div>
                )}
              </SecondaryReportPage>
            )}

            <Card className="rounded-3xl border-black/5 shadow-sm overflow-hidden w-full">
              <CardHeader className="bg-gradient-to-r from-indigo-50 to-violet-50 border-b border-black/5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-violet-100 rounded-xl"><Route className="w-4 h-4 text-violet-700"/></div>
                    <div>
                      <CardTitle className="text-sm font-bold">用户旅程明细（可选）</CardTitle>
                      <p className="text-xs text-[#86868b] mt-0.5">深度洞察里已含决策路径；此处为 5W1H 明细附表</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(journeyRows.length > 0 || journeyReportRaw) && (
                      <button
                        type="button"
                        onClick={() => setJourneyOpen(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-xl text-sm font-semibold hover:bg-indigo-50"
                      >
                        <Route className="w-4 h-4"/>
                        查看旅程
                      </button>
                    )}
                    <button onClick={runJourneyReport} disabled={isJourneyLoading} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
                      {isJourneyLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Route className="w-4 h-4"/>}
                      {isJourneyLoading ? '生成中...' : journeyRows.length > 0 ? '重新生成' : '生成旅程表'}
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <button
                  type="button"
                  onClick={() => {
                    if (journeyRows.length > 0 || journeyReportRaw) setJourneyOpen(true);
                  }}
                  disabled={!(journeyRows.length > 0 || journeyReportRaw)}
                  className={`w-full min-h-[140px] rounded-2xl border border-dashed p-6 text-left transition-all ${
                    journeyRows.length > 0 || journeyReportRaw
                      ? 'border-violet-200 bg-violet-50/35 hover:bg-violet-50 hover:border-violet-300 cursor-pointer'
                      : 'border-black/10 bg-[#f8f9fb] cursor-default'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${journeyRows.length > 0 || journeyReportRaw ? 'bg-violet-600 text-white' : 'bg-white text-zinc-300 border border-black/5'}`}>
                        <Route className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-[#1d1d1f] mb-1">
                          {journeyRows.length > 0 || journeyReportRaw ? '5W1H 旅程表已生成' : '5W1H 旅程表未生成'}
                        </div>
                        <p className="text-sm text-[#86868b] leading-relaxed max-w-2xl">
                          {journeyRows.length > 0 || journeyReportRaw
                            ? '点击此卡片进入宽屏旅程页，查看阶段路径、证据引用和改进动作。'
                            : '这是深度洞察的可选附表；需要更细的用户路径拆解时再生成。'}
                        </p>
                      </div>
                    </div>
                    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold shrink-0 ${journeyRows.length > 0 || journeyReportRaw ? 'bg-white text-violet-700 border border-violet-200' : 'bg-white text-[#86868b] border border-black/5'}`}>
                      <Route className="w-4 h-4" />
                      {journeyRows.length > 0 || journeyReportRaw ? '打开旅程' : '等待生成'}
                    </div>
                  </div>
                </button>
              </CardContent>
            </Card>

            {journeyOpen && (journeyRows.length > 0 || journeyReportRaw) && (
              <SecondaryReportPage
                title="用户旅程 5W1H"
                subtitle="严格按评论事实 · 宽屏排版"
                icon={<Route className="w-5 h-5" />}
                onClose={() => setJourneyOpen(false)}
                onRegenerate={() => void runJourneyReport()}
                regenerating={isJourneyLoading}
                extraActions={
                  journeyRows.length > 0 ? (
                    <div className="hidden sm:flex items-center gap-1 rounded-full bg-indigo-50 p-1 border border-indigo-100">
                      <button
                        type="button"
                        onClick={() => setJourneyViewMode('timeline')}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${journeyViewMode === 'timeline' ? 'bg-indigo-600 text-white' : 'text-indigo-700 hover:bg-white'}`}
                      >
                        时间线
                      </button>
                      <button
                        type="button"
                        onClick={() => setJourneyViewMode('table')}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${journeyViewMode === 'table' ? 'bg-indigo-600 text-white' : 'text-indigo-700 hover:bg-white'}`}
                      >
                        表格
                      </button>
                    </div>
                  ) : null
                }
              >
                {journeyRows.length > 0 ? (
                  <div key={`journey-parsed-${journeyMountId}`} className="space-y-6">
                    <div className="sm:hidden flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setJourneyViewMode('timeline')}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold ${journeyViewMode === 'timeline' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700'}`}
                      >
                        时间线
                      </button>
                      <button
                        type="button"
                        onClick={() => setJourneyViewMode('table')}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold ${journeyViewMode === 'table' ? 'bg-indigo-600 text-white' : 'bg-indigo-50 text-indigo-700'}`}
                      >
                        表格
                      </button>
                    </div>
                    {journeyViewMode === 'timeline' ? (
                      <div className="space-y-0">
                        {journeyRows.map((r, i) => (
                          <div key={`jm-${journeyMountId}-${i}-${r.stage.slice(0, 32)}`} className="relative pl-8 pb-10 last:pb-2 border-l-2 border-indigo-200 ml-3">
                            <div className="absolute left-[-9px] top-2 w-4 h-4 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 border-2 border-white shadow-sm shadow-indigo-200" />
                            <div className="rounded-[22px] border border-indigo-50 bg-gradient-to-br from-white to-indigo-50/40 p-5 sm:p-6 shadow-[0_12px_30px_-20px_rgba(79,70,229,0.45)]">
                              <div className="flex flex-wrap items-baseline gap-2 mb-4">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-800 bg-indigo-100/90 px-2.5 py-1 rounded-full">阶段 {i + 1}</span>
                                <h4 className="text-base sm:text-lg font-semibold text-[#1d1d1f] leading-snug">{r.stage}</h4>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                                {[
                                  ['Who 谁', r.who],
                                  ['Where 在哪', r.where],
                                  ['When 何时', r.when],
                                  ['What 做了什么', r.what],
                                  ['Why 为何', r.why],
                                  ['How 怎么做', r.how],
                                ].map(([k, v]) => (
                                  <div key={String(k)} className="rounded-2xl bg-white border border-indigo-50 px-3.5 py-3 min-h-[72px]">
                                    <div className="text-[11px] font-semibold text-indigo-500">{k}</div>
                                    <div className="text-sm text-[#424245] mt-1.5 leading-relaxed">{v}</div>
                                  </div>
                                ))}
                              </div>
                              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 px-4 py-3.5 mb-4">
                                <div className="text-[11px] font-semibold text-indigo-800 mb-2.5">代表评论原句</div>
                                <div className="space-y-3">
                                  {splitJourneyQuoteLines(r.quote).map((line, qi) => {
                                    const qKey = `jq-${i}-${qi}`;
                                    const matched = findReviewForQuoteLine(line, filteredReviews);
                                    return (
                                      <div key={qKey} className="rounded-xl border border-white bg-white/90 p-3.5 shadow-sm">
                                        <p className="text-[15px] text-[#1d1d1f] leading-relaxed whitespace-pre-wrap">{line}</p>
                                        {matched?.imageUrls && matched.imageUrls.length > 0 ? (
                                          <div className="mt-3 flex flex-wrap gap-2">
                                            {matched.imageUrls.slice(0, 8).map((url, uidx) => (
                                              <button key={`${qKey}-img-${uidx}`} type="button" onClick={() => setMediaPreview({ type: 'image', url })} className="block">
                                                <img src={url} alt="" loading="lazy" decoding="async" className="h-20 w-20 rounded-xl object-cover border border-indigo-50" />
                                              </button>
                                            ))}
                                          </div>
                                        ) : null}
                                        {matched?.videoUrls && matched.videoUrls.length > 0 ? (
                                          <div className="mt-2 flex flex-wrap gap-2">
                                            {matched.videoUrls.slice(0, 3).map((url, uidx) => (
                                              <button key={`${qKey}-v-${uidx}`} type="button" onClick={() => setMediaPreview({ type: 'video', url })} className="text-xs px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100">
                                                视频 {uidx + 1}
                                              </button>
                                            ))}
                                          </div>
                                        ) : null}
                                        <button
                                          type="button"
                                          onClick={() => void translateJourneyQuoteLine(qKey, line)}
                                          className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                                        >
                                          <Languages className="h-3.5 w-3.5" />
                                          {journeyQuoteTrLoading === qKey ? '翻译中…' : journeyQuoteTr[qKey] ? (journeyQuoteTrShow[qKey] ? '收起译文' : '查看译文') : '译为中文'}
                                        </button>
                                        {journeyQuoteTr[qKey] && journeyQuoteTrShow[qKey] ? (
                                          <p className="mt-2 text-sm text-[#3a3a3c] leading-relaxed whitespace-pre-wrap rounded-xl border border-indigo-50 bg-[#faf9ff] p-2.5">{journeyQuoteTr[qKey]}</p>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="rounded-2xl border border-rose-100 bg-rose-50/70 p-4">
                                  <div className="text-[11px] font-semibold text-rose-800">当前方案劣势</div>
                                  <p className="text-sm text-rose-900 mt-1.5 leading-relaxed">{r.weakness}</p>
                                </div>
                                <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                                  <div className="text-[11px] font-semibold text-emerald-800">可能的改进方案</div>
                                  <p className="text-sm text-emerald-900 mt-1.5 leading-relaxed">{r.improvement}</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="overflow-auto border border-indigo-50 rounded-2xl">
                        <table className="min-w-[1100px] w-full text-sm">
                          <thead className="bg-indigo-50/80 sticky top-0 z-10">
                            <tr className="text-left text-indigo-950">
                              <th className="px-3 py-3 border-b border-indigo-100">阶段</th>
                              <th className="px-3 py-3 border-b border-indigo-100">Who</th>
                              <th className="px-3 py-3 border-b border-indigo-100">Where</th>
                              <th className="px-3 py-3 border-b border-indigo-100">When</th>
                              <th className="px-3 py-3 border-b border-indigo-100">What</th>
                              <th className="px-3 py-3 border-b border-indigo-100">Why</th>
                              <th className="px-3 py-3 border-b border-indigo-100">How</th>
                              <th className="px-3 py-3 border-b border-indigo-100">代表评论原句</th>
                              <th className="px-3 py-3 border-b border-indigo-100">劣势</th>
                              <th className="px-3 py-3 border-b border-indigo-100">改进</th>
                            </tr>
                          </thead>
                          <tbody>
                            {journeyRows.map((r, i) => (
                              <tr key={`jmt-${journeyMountId}-${i}-${r.stage.slice(0, 24)}`} className="align-top odd:bg-white even:bg-[#faf9ff]">
                                <td className="px-3 py-3 border-b border-indigo-50 font-semibold text-[#1d1d1f]">{r.stage}</td>
                                <td className="px-3 py-3 border-b border-indigo-50 text-[#424245]">{r.who}</td>
                                <td className="px-3 py-3 border-b border-indigo-50 text-[#424245]">{r.where}</td>
                                <td className="px-3 py-3 border-b border-indigo-50 text-[#424245]">{r.when}</td>
                                <td className="px-3 py-3 border-b border-indigo-50 text-[#424245]">{r.what}</td>
                                <td className="px-3 py-3 border-b border-indigo-50 text-[#424245]">{r.why}</td>
                                <td className="px-3 py-3 border-b border-indigo-50 text-[#424245]">{r.how}</td>
                                <td className="px-3 py-3 border-b border-indigo-50 text-[#1d1d1f] max-w-[420px]">
                                  <div className="space-y-3">
                                    {splitJourneyQuoteLines(r.quote).map((line, qi) => {
                                      const qKey = `jq-${i}-${qi}`;
                                      const matched = findReviewForQuoteLine(line, filteredReviews);
                                      return (
                                        <div key={qKey} className="border-b border-indigo-50 pb-2 last:border-0 last:pb-0">
                                          <p className="whitespace-pre-wrap leading-relaxed">{line}</p>
                                          {matched?.imageUrls && matched.imageUrls.length > 0 ? (
                                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                              {matched.imageUrls.slice(0, 6).map((url, uidx) => (
                                                <button key={`${qKey}-im-${uidx}`} type="button" onClick={() => setMediaPreview({ type: 'image', url })} className="block">
                                                  <img src={url} alt="" loading="lazy" decoding="async" className="h-12 w-12 rounded-md object-cover border border-indigo-50" />
                                                </button>
                                              ))}
                                            </div>
                                          ) : null}
                                          <button type="button" onClick={() => void translateJourneyQuoteLine(qKey, line)} className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600">
                                            <Languages className="h-3 w-3" />
                                            {journeyQuoteTrLoading === qKey ? '…' : journeyQuoteTr[qKey] ? (journeyQuoteTrShow[qKey] ? '收起' : '译文') : '翻译'}
                                          </button>
                                          {journeyQuoteTr[qKey] && journeyQuoteTrShow[qKey] ? (
                                            <p className="mt-1 text-[11px] text-[#3a3a3c] bg-[#faf9ff] rounded p-1.5">{journeyQuoteTr[qKey]}</p>
                                          ) : null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </td>
                                <td className="px-3 py-3 border-b border-indigo-50 text-rose-700">{r.weakness}</td>
                                <td className="px-3 py-3 border-b border-indigo-50 text-emerald-700">{r.improvement}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={`journey-raw-${journeyMountId}`} className="space-y-4">
                    <div className="rounded-2xl border border-amber-200/90 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 leading-relaxed">
                      <span className="font-semibold text-amber-900">AI 返回格式不规范，无法生成结构化旅程表</span>
                      。建议：① 在「AI 设置 → AI 提示词」找到「VOC Step4: 用户旅程5W1H」点击恢复默认；② 缩小筛选条件后重新生成。下方保留原文。
                    </div>
                    <pre className="overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-indigo-50 bg-[#faf9ff] p-5 text-sm leading-relaxed text-[#424245]">{journeyReportRaw}</pre>
                  </div>
                )}
              </SecondaryReportPage>
            )}
          </div>

          {/* Reviews List */}
          <Card className="rounded-3xl border-black/5 shadow-sm overflow-hidden">
            <CardHeader className="space-y-3 bg-[#f5f5f7]/50 border-b border-black/5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle className="text-sm font-bold shrink-0">评论明细列表</CardTitle>
                <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
                  <div className="relative min-w-0 w-full sm:max-w-xs">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8e8e93]" />
                    <input
                      type="text"
                      placeholder="搜索标题或正文（仅本列表）"
                      value={listSearchTerm}
                      onChange={(e) => {
                        setListSearchTerm(e.target.value);
                        setPage(1);
                      }}
                      className="w-full rounded-lg border border-black/5 bg-white py-2 pl-8 pr-3 text-xs text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-200"
                    />
                  </div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-black/5 bg-white px-3 py-2 text-xs font-medium text-[#424245]">
                    <input
                      type="checkbox"
                      checked={listMediaOnly}
                      onChange={(e) => {
                        setListMediaOnly(e.target.checked);
                        setPage(1);
                      }}
                      className="rounded border-black/20 text-indigo-600 focus:ring-indigo-200"
                    />
                    仅看带图/视频
                  </label>
                  {(listSearchTerm.trim() || listMediaOnly) ? (
                    <button type="button" onClick={resetListOnlyFilters} className="text-xs font-medium text-rose-600 hover:underline">
                      清除列表条件
                    </button>
                  ) : null}
                  <Select
                    value={sortBy}
                    onChange={(v) => { setSortBy(v as 'helpful' | 'date'); setPage(1); }}
                    options={[
                      { value: 'helpful', label: '按点赞数' },
                      { value: 'date', label: '按评论时间' },
                    ]}
                    size="sm"
                    aria-label="排序字段"
                  />
                  <Select
                    value={sortOrder}
                    onChange={(v) => { setSortOrder(v as 'asc' | 'desc'); setPage(1); }}
                    options={[
                      { value: 'desc', label: '降序' },
                      { value: 'asc', label: '升序' },
                    ]}
                    size="sm"
                    aria-label="排序方向"
                  />
                  <span className="text-xs text-[#86868b] whitespace-nowrap">第 {page}/{totalPages} 页 · 本列表 {reviewsForList.length} 条</span>
                  <div className="flex bg-[#f5f5f7] rounded-lg p-1 border border-black/5">
                    <button onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1} className="p-1 hover:bg-white rounded disabled:opacity-30"><ChevronLeft className="w-4 h-4"/></button>
                    <button onClick={() => setPage(p => Math.min(totalPages,p+1))} disabled={page===totalPages} className="p-1 hover:bg-white rounded disabled:opacity-30"><ChevronRight className="w-4 h-4"/></button>
                  </div>
                </div>
              </div>
            </CardHeader>
            <div className="divide-y divide-black/5">
              {pagedReviews.map(review => {
                const isExpanded = Boolean(expandedReviewIds[review.id]);
                const plain = review.content || '';
                const shouldCollapse = plain.length > 220;
                const visibleText = shouldCollapse && !isExpanded ? `${plain.slice(0, 220)}...` : plain;
                return (
                <div key={review.id} className="p-5 hover:bg-[#f5f5f7]/30 transition-colors">
                  <div className="flex items-start gap-3 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="flex">{[...Array(5)].map((_,i) => <span key={i} className={`text-xs ${i < review.rating ? 'text-amber-400':'text-gray-200'}`}>★</span>)}</div>
                        <span className="text-xs text-[#86868b]">时间:{review.date || '未知'}</span>
                        {review.asin && <span className="text-[10px] font-mono bg-[#f5f5f7] px-1.5 py-0.5 rounded text-[#86868b]">{review.asin}</span>}
                        {review.childAsin && <span className="text-[10px] font-mono bg-indigo-50 px-1.5 py-0.5 rounded text-indigo-700">子体:{review.childAsin}</span>}
                        {review.country && <span className="text-[10px] bg-emerald-50 px-1.5 py-0.5 rounded text-emerald-700">国家:{review.country}</span>}
                        {review.isVp && <span className="text-[10px] bg-purple-50 px-1.5 py-0.5 rounded text-purple-700">VP</span>}
                        {(review.hasImage || review.hasVideo) && <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">{review.hasVideo ? '视频' : '图片'}</span>}
                        <span className="flex items-center gap-1 text-[10px] text-emerald-600"><Heart className="w-3 h-3"/>{review.helpful || 0}</span>
                      </div>
                      <h4 className="font-bold text-[#1d1d1f] text-sm mb-1">{review.title}</h4>
                      <p className="text-sm text-[#424245] leading-relaxed whitespace-pre-wrap">{visibleText}</p>
                      {review.imageUrls && review.imageUrls.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {review.imageUrls.slice(0, 4).map((url, idx) => (
                            <button
                              key={`${review.id}_img_${idx}`}
                              type="button"
                              onClick={() => setMediaPreview({ type: 'image', url })}
                              className="block"
                            >
                              <img src={url} alt="" className="w-14 h-14 rounded-lg object-cover border border-black/5" />
                            </button>
                          ))}
                        </div>
                      )}
                      {review.videoUrls && review.videoUrls.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {review.videoUrls.slice(0, 3).map((url, idx) => (
                            <button
                              key={`${review.id}_video_${idx}`}
                              type="button"
                              onClick={() => setMediaPreview({ type: 'video', url })}
                              className="text-xs px-2 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
                            >
                              视频{idx + 1}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => void translateReview(review)}
                          className="text-xs text-indigo-600 hover:text-indigo-700"
                        >
                          {translatingId === review.id ? '翻译中...' : (translatedMap[review.id] ? (translatedVisibleMap[review.id] ? '收起翻译' : '查看翻译') : '翻译为中文')}
                        </button>
                        {translatedMap[review.id] && translatedVisibleMap[review.id] && (
                          <p className="mt-1 text-sm text-[#3a3a3c] leading-relaxed whitespace-pre-wrap bg-[#fafafa] rounded-lg p-2">
                            {translatedMap[review.id]}
                          </p>
                        )}
                      </div>
                      {shouldCollapse && (
                        <button
                          type="button"
                          onClick={() => setExpandedReviewIds((prev) => ({ ...prev, [review.id]: !isExpanded }))}
                          className="mt-1 text-xs text-indigo-600 hover:text-indigo-700"
                        >
                          {isExpanded ? '收起' : '展开全文'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-start gap-2">
                    <span className="text-[11px] text-[#86868b] shrink-0">标签:</span>
                    {review.tags ? (
                      <div className="flex flex-wrap gap-1.5">
                        {review.tags.positive.map((t,i) => <span key={i} onClick={() => toggleTagFilterOneDim(t,'positive')} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full border border-emerald-100 cursor-pointer hover:bg-emerald-100">{t}</span>)}
                        {review.tags.negative.map((t,i) => <span key={i} onClick={() => toggleTagFilterOneDim(t,'negative')} className="px-2 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-bold rounded-full border border-rose-100 cursor-pointer hover:bg-rose-100">{t}</span>)}
                        {review.tags.scenarios.map((t,i) => <span key={i} onClick={() => toggleTagFilterOneDim(t,'scenarios')} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-full border border-indigo-100 cursor-pointer hover:bg-indigo-100">{t}</span>)}
                        {review.tags.audience.map((t,i) => <span key={i} onClick={() => toggleTagFilterOneDim(t,'audience')} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-100 cursor-pointer hover:bg-amber-100">{t}</span>)}
                      </div>
                    ) : (
                      <span className="text-[11px] text-[#b0b0b5]">未打标</span>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </Card>

          {mediaPreview && (
            <div className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-4">
              <button
                type="button"
                className="absolute inset-0"
                onClick={() => setMediaPreview(null)}
                aria-label="关闭预览"
              />
              <div className="relative z-10 max-w-[90vw] max-h-[90vh]">
                {mediaPreview.type === 'image' ? (
                  <img src={mediaPreview.url} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl" />
                ) : (
                  <video src={mediaPreview.url} controls className="max-w-[90vw] max-h-[90vh] rounded-xl shadow-2xl bg-black" />
                )}
                <button
                  type="button"
                  onClick={() => setMediaPreview(null)}
                  className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-white text-[#1d1d1f] shadow-md"
                >
                  ×
                </button>
              </div>
            </div>
          )}

          {tagModal && (
            <div className="fixed inset-0 z-[95] bg-black/45 flex items-center justify-center p-4">
              <button type="button" className="absolute inset-0" onClick={() => setTagModal(null)} aria-label="关闭标签详情" />
              <div className="relative z-10 w-full max-w-5xl max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-black/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-[#1d1d1f]">标签评论详情：{tagModal.tag}</h3>
                    <p className="text-xs text-[#6e6e73] mt-1">共 {tagModalReviews.length} 条，已按当前筛选与排序规则显示</p>
                  </div>
                  <button type="button" className="w-8 h-8 rounded-full bg-[#f5f5f7] text-[#1d1d1f]" onClick={() => setTagModal(null)}>×</button>
                </div>
                <div className="max-h-[70vh] overflow-auto divide-y divide-black/5">
                  {tagModalReviews.map((review) => (
                    <div key={`tag_modal_${review.id}`} className="p-4">
                      <div className="flex items-center gap-2 mb-1 text-xs text-[#6e6e73]">
                        <span>时间:{review.date || '未知'}</span>
                        {review.asin && <span className="font-mono bg-[#f5f5f7] px-1.5 py-0.5 rounded">{review.asin}</span>}
                        {review.childAsin && <span className="font-mono bg-indigo-50 px-1.5 py-0.5 rounded text-indigo-700">型号:{review.childAsin}</span>}
                        {review.country && <span className="bg-emerald-50 px-1.5 py-0.5 rounded text-emerald-700">{review.country}</span>}
                        <span className="text-emerald-600">👍 {review.helpful || 0}</span>
                      </div>
                      <h4 className="text-sm font-semibold text-[#1d1d1f]">{review.title}</h4>
                      <p className="text-sm text-[#424245] leading-relaxed whitespace-pre-wrap mt-1">{review.content}</p>
                      {review.tags && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {review.tags.positive.map((t, i) => <span key={`m_p_${review.id}_${i}`} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded-full border border-emerald-100">{t}</span>)}
                          {review.tags.negative.map((t, i) => <span key={`m_n_${review.id}_${i}`} className="px-2 py-0.5 bg-rose-50 text-rose-700 text-[10px] font-bold rounded-full border border-rose-100">{t}</span>)}
                          {review.tags.scenarios.map((t, i) => <span key={`m_s_${review.id}_${i}`} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-full border border-indigo-100">{t}</span>)}
                          {review.tags.audience.map((t, i) => <span key={`m_a_${review.id}_${i}`} className="px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-100">{t}</span>)}
                        </div>
                      )}
                    </div>
                  ))}
                  {tagModalReviews.length === 0 && (
                    <div className="p-8 text-center text-sm text-[#86868b]">当前筛选条件下没有命中该标签的评论。</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
});
