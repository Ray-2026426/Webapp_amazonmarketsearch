// 五看「AI 分析」共享模块：把各看的数据上下文 + 用户背景组装成结构化 Prompt，
// 调用现有 generateText(prompt, settings, { jsonMode }) 并解析回可回填的结论 JSON。
// 复用 aiConfig，不新增模型/成本配置。

import { get } from 'idb-keyval';
import { generateText, loadAiSettings, type AiSettings } from './aiConfig';
import { loadUserBackground, buildUserBackgroundSystemPrompt } from './userBackground';
import type { Product, Review, Keyword } from './parser';

export interface LookAiResult {
  ok: boolean;
  error?: string;
  /** 各看回填的结论（结构由各看约定） */
  data?: Record<string, unknown>;
}

/** 尝试解析 AI 返回的 JSON（容错：剥离 ```json 包裹、截取第一个 { 到最后一个 }）。 */
export function tryParseJson<T = Record<string, unknown>>(raw: string): T | null {
  if (!raw) return null;
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    const arrStart = text.indexOf('[');
    const arrEnd = text.lastIndexOf(']');
    if (arrStart < 0 || arrEnd <= arrStart) return null;
    text = text.slice(arrStart, arrEnd + 1);
  } else {
    text = text.slice(start, end + 1);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 从 IndexedDB 读取全局市场工作区数据，作为 AI 分析原料。 */
export interface GlobalMarketData {
  loaded: boolean;
  marketplace: string;
  productCount: number;
  products: Product[];
  historyMonths: string[];
  reviews: Review[];
  keywords: Keyword[];
  competitorAsins: string[];
  isDemo: boolean;
  /** 细分市场与 ASIN 归属（供细分评分） */
  segments: string[];
  asinToSegment: Record<string, string>;
  /** 历史趋势数据（供细分趋势分） */
  history: import('./parser').HistoryRecord[];
  /** 细分市场描述（people/scenarios/needs），供看用户与细分联合分析 */
  segmentDescriptions: Record<string, { people: string; scenarios: string; needs: string }>;
}

const DEMO_RE = /demo|示例|sample/i;

export async function gatherGlobalMarketData(): Promise<GlobalMarketData> {
  const [products, reviews, keywords, months, marketplace, compWorkspace, segments, asinToSegment, history, segmentDescriptions] = await Promise.all([
    get('products'),
    get('reviews'),
    get('keywords'),
    get('months'),
    get('marketplace'),
    get('competitorWorkspace'),
    get('segments'),
    get('asinToSegment'),
    get('history'),
    get('segmentDescriptions'),
  ] as const);
  const productList = Array.isArray(products) ? (products as Product[]) : [];
  const reviewList = Array.isArray(reviews) ? (reviews as Review[]) : [];
  const keywordList = Array.isArray(keywords) ? (keywords as Keyword[]) : [];
  const monthList = Array.isArray(months) ? (months as string[]) : [];
  const mkt = marketplace as { code?: string } | string | undefined;
  const marketplaceCode = typeof mkt === 'string' ? mkt : (mkt?.code ?? '');
  const comp = compWorkspace as { selected?: string[] } | null | undefined;
  const competitorAsins = Array.isArray(comp?.selected) ? comp.selected : [];
  const segmentList = Array.isArray(segments) ? (segments as string[]) : [];
  const segMap = asinToSegment && typeof asinToSegment === 'object' ? (asinToSegment as Record<string, string>) : {};
  const histList = Array.isArray(history) ? (history as import('./parser').HistoryRecord[]) : [];
  const segDesc = segmentDescriptions && typeof segmentDescriptions === 'object' ? (segmentDescriptions as Record<string, { people: string; scenarios: string; needs: string }>) : {};

  return {
    loaded: productList.length > 0 || reviewList.length > 0 || keywordList.length > 0 || competitorAsins.length > 0,
    marketplace: marketplaceCode,
    productCount: productList.length,
    products: productList,
    historyMonths: monthList,
    reviews: reviewList,
    keywords: keywordList,
    competitorAsins,
    isDemo: DEMO_RE.test(marketplaceCode),
    segments: segmentList,
    asinToSegment: segMap,
    history: histList,
    segmentDescriptions: segDesc,
  };
}

/** 把市场数据压缩成 AI 可读的文本摘要（控制 token 量）。 */
function summarizeMarketData(g: GlobalMarketData): string {
  const lines: string[] = [];
  lines.push(`站点：${g.marketplace || '未知'}`);
  lines.push(`商品数：${g.productCount}；历史月份：${g.historyMonths.join(', ') || '无'}`);
  lines.push(`评论数：${g.reviews.length}；关键词数：${g.keywords.length}`);
  lines.push(`竞品 ASIN：${g.competitorAsins.join(', ') || '无'}`);
  const sample = g.products.slice(0, 25).map((p) => {
    const asin = (p as { asin?: string }).asin ?? '';
    const title = (p as { title?: string }).title ?? '';
    const price = (p as { price?: unknown }).price ?? (p as { priceUsd?: unknown }).priceUsd ?? '?';
    const rating = (p as { rating?: unknown }).rating ?? (p as { score?: unknown }).score ?? '?';
    const bsr = (p as { bsr?: unknown }).bsr ?? (p as { rank?: unknown }).rank ?? '?';
    return `[${asin}] ${title} | 价:${price} | 星:${rating} | BSR:${bsr}`;
  });
  if (sample.length) {
    lines.push('—— 商品抽样 ——');
    lines.push(...sample);
  }
  const reviewSample = g.reviews.slice(0, 15).map((r) => {
    const star = (r as { rating?: number }).rating ?? (r as { star?: number }).star ?? '?';
    return `${star}星:${(r as { content?: string }).content ?? ''}`;
  });
  if (reviewSample.length) {
    lines.push('—— 评论抽样 ——');
    lines.push(...reviewSample);
  }
  const kwSample = g.keywords.slice(0, 30).map((k) => {
    const vol = (k as { searchVolume?: number }).searchVolume ?? (k as { volume?: number }).volume ?? '?';
    return `${(k as { keyword?: string }).keyword || ''}(${vol})`;
  });
  if (kwSample.length) {
    lines.push('—— 关键词抽样 ——');
    lines.push(kwSample.join('、'));
  }
  // 细分市场描述：看用户与看市场的联合分析输入（people/scenarios/needs）
  const segDescEntries = Object.entries(g.segmentDescriptions || {}).filter(([, v]) => v && (v.people || v.scenarios || v.needs));
  if (segDescEntries.length) {
    lines.push('—— 市场细分（人群/场景/需求描述） ——');
    for (const [name, d] of segDescEntries) {
      lines.push(`细分「${name}」：人群:${d.people || '?'} | 场景:${d.scenarios || '?'} | 需求:${d.needs || '?'}`);
    }
  }
  return lines.join('\n');
}

export interface MarketAnalysisOutput {
  attractiveness?: string;
  keyEvidences?: string[];
  risks?: string[];
  openQuestions?: string[];
}

export interface UserAnalysisOutput {
  targetUser?: string;
  scenario?: string;
  jobToBeDone?: string;
  satisfiedNeeds?: string[];
  unmetNeedCandidates?: {
    targetUser?: string;
    scenario?: string;
    jobToBeDone?: string;
    needStatement?: string;
    currentAlternative?: string;
    evidenceStrength?: 'high' | 'medium' | 'low';
  }[];
}

export interface CompetitorAnalysisOutput {
  samplePool?: string[];
  benchmarkAsins?: string[];
  productPowerFindings?: string[];
  operationPowerFindings?: string[];
  barriers?: string;
  needMatrix?: string;
  gaps?: string[];
}

export interface SelfAnalysisOutput {
  /** 生成 JSON 无法直接写复杂对象，这里输出结构化文本结论 */
  conclusion?: string;
  strengths?: string[];
  gaps?: string[];
  hardConstraints?: string[];
  fitAssessment?: string;
  /** 引导式问答后 AI 建议的自评摘要 */
  summary?: string;
}

function buildSystemPromptFor(look: string): string {
  const bg = buildUserBackgroundSystemPrompt();
  return `你是资深亚马逊市场调研与选品决策顾问，擅长用「看市场 / 看用户 / 看竞品 / 看自己」五看方法论输出结构化结论。请严格输出 JSON 对象，不要输出 Markdown 代码块或解释文字。${bg ? bg + '\n\n' : '\n\n'}以下分析只基于所提供的真实数据，不要虚构未提供的数据。`;
}

/**
 * 统一的「看」AI 分析出口。
 * @param look market|user|competitor|self
 * @param extra 附加数据（如自评的用户回答、竞品列表等）
 */
export async function runLookAnalysis(
  look: 'market' | 'user' | 'competitor' | 'self',
  extra?: Record<string, unknown>
): Promise<LookAiResult> {
  const settings = loadAiSettings();
  if (!settings.apiKey) {
    return { ok: false, error: '尚未配置 AI 模型 Key，请先到「设置 → API 与模型」填写。' };
  }

  const data = await gatherGlobalMarketData();
  const summary = summarizeMarketData(data);

  let prompt: string;
  let system: string = buildSystemPromptFor(look);

  if (look === 'market') {
    if (!data.loaded) return { ok: false, error: '尚未加载任何市场数据，请先到「市场大盘」上传 Excel 或加载示例数据。' };
    prompt = `请基于以下市场数据，完成「看市场」分析，输出 JSON：
{
  "attractiveness": "市场吸引力综合判断（规模/趋势/竞争结构/价格带/进入窗口，200字内）",
  "keyEvidences": ["3-5 条关键证据（含数字）"],
  "risks": ["主要市场风险（2-4条）"],
  "openQuestions": ["对看用户/看竞品的待验证问题（2-4条）"]
}
数据：
${summary}`;
  } else if (look === 'user') {
    if (data.reviews.length === 0 && data.keywords.length === 0) {
      return { ok: false, error: '尚未加载评论或关键词数据，请先到「关键词分析」或「评论/VOC」加载。' };
    }
    prompt = `请基于以下关键词、评论，以及「市场细分」的已有人群/场景/需求描述，完成「看用户」分析（关键词 + VOC 合并，并吸收市场细分的用户洞察），输出 JSON：
{
  "targetUser": "目标用户画像一句话",
  "scenario": "典型使用场景",
  "jobToBeDone": "用户要完成的 JTBD（任务）",
  "satisfiedNeeds": ["已满足的需求（2-4条）"],
  "unmetNeedCandidates": [
    {"targetUser":"","scenario":"","jobToBeDone":"","needStatement":"未满足需求（含证据）","currentAlternative":"用户目前替代方案及代价","evidenceStrength":"high|medium|low"}
  ]
}
要点：
1) 把「市场细分」里的人群(people)/场景(scenarios)/需求(needs) 与评论/关键词交叉，形成更具体的用户分类，并在输出中体现这些细分视角。
2) 未满足需求候选 1-4 条，必须来自重复出现的问题/差评/关键词，并说明替代方案。
数据：
${summary}`;
  } else if (look === 'competitor') {
    if (data.competitorAsins.length === 0) {
      return { ok: false, error: '尚未选择竞品 ASIN，请先到「竞品对比」添加竞品。' };
    }
    prompt = `请基于以下竞品数据，完成「看竞品」分析（产品层 + 主体层），输出 JSON：
{
  "samplePool": ["竞品样本池分层（按价格带/定位分）"],
  "benchmarkAsins": ["标杆 ASIN（2-3个，说明为何是标杆）"],
  "productPowerFindings": ["产品力拆解：功能/材质/设计/体验/差评痛点，2-4条"],
  "operationPowerFindings": ["运营力拆解：Listing/主图/流量结构/价格/评价壁垒，2-4条"],
  "barriers": "竞争壁垒与经营能力（100字内）",
  "needMatrix": "用户需求满足矩阵（哪些方面满足、哪些不足）",
  "gaps": ["未充分满足的产品缺口（2-4条）"]
}
竞品 ASIN：${data.competitorAsins.join(', ')}
数据：
${summary}`;
  } else {
    // self
    const answers = (extra?.answers as Record<string, string> | undefined) ?? {};
    const answerLines = Object.entries(answers)
      .filter(([, v]) => String(v || '').trim())
      .map(([k, v]) => `- ${k}：${v}`)
      .join('\n');
    if (!answerLines.trim()) {
      return { ok: false, error: '请先回答几个引导问题（目标/预算/供应链/毛利要求等），AI 才能判断自身适配度。' };
    }
    prompt = `请结合以下「用户背景」与「团队简要回答」，完成「看自己」分析，判断团队解决某个未满足需求的适配度，输出 JSON：
{
  "conclusion": "自身适配度总体判断（100字内）",
  "strengths": ["自身优势（2-4条）"],
  "gaps": ["能力缺口（2-4条）"],
  "hardConstraints": ["硬约束与止损边界（2-4条）"],
  "fitAssessment": "对机会卡的适配度评价",
  "summary": "一段给团队看的结构化自评总结"
}
团队回答：
${answerLines}`;
  }

  try {
    const raw = await generateText(prompt, settings, { jsonMode: true, systemPrompt: system });
    const parsed = tryParseJson<Record<string, unknown>>(raw);
    if (!parsed) return { ok: false, error: 'AI 返回格式无法解析，请重试。' };
    return { ok: true, data: parsed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'AI 分析失败' };
  }
}

// 供组件判断是否有数据
export interface LookDataPresence {
  hasMarket: boolean;
  hasUser: boolean;
  hasCompetitor: boolean;
}

export async function gatherLookPresence(): Promise<LookDataPresence> {
  const g = await gatherGlobalMarketData();
  return {
    hasMarket: g.loaded,
    hasUser: g.reviews.length > 0 || g.keywords.length > 0,
    hasCompetitor: g.competitorAsins.length > 0,
  };
}

// 保留 settings 类型引用（供未来扩展），避免未使用告警
export type { AiSettings };
