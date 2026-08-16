import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Keyword, parseKeywords, UserIntentStage, JobType } from '../utils/parser';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { getPrompt } from './AiPromptManager';
import { fetchKeywordsFromMcp, fetchKeywordsByKeywordFromMcp } from '../utils/sellerspriteApi';
import { toast } from 'sonner';
import { KwView } from './KeywordAnalysisView';
import { McpFetchPanel, type KeywordFetchSource } from './McpFetchPanel';
import * as XLSX from 'xlsx';

export const TAGS = ['人群词','场景词','品牌词','尺寸词','数量词','颜色词','材质词','功能词'];
export const SC = ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#14b8a6','#a855f7','#0ea5e9','#d946ef','#22c55e','#f43f5e','#fb923c','#facc15','#4ade80','#38bdf8','#c084fc'];

export const INTENT_META: Record<UserIntentStage, { label: string; color: string; bg: string; desc: string; order: number }> = {
  awareness:     { label: '认知型', color: '#8b5cf6', bg: 'bg-violet-50',  desc: '发现问题，寻找解决方案', order: 0 },
  consideration: { label: '考虑型', color: '#3b82f6', bg: 'bg-blue-50',    desc: '对比筛选，评估哪个适合我', order: 1 },
  decision:      { label: '决策型', color: '#10b981', bg: 'bg-emerald-50', desc: '规格明确，准备下单', order: 2 },
  loyalty:       { label: '忠诚型', color: '#f59e0b', bg: 'bg-amber-50',   desc: '品牌复购、配件替换', order: 3 },
};

export const JOB_TYPE_META: Record<JobType, { label: string; color: string; bg: string }> = {
  functional: { label: '功能性任务', color: '#3b82f6', bg: 'bg-blue-50' },
  emotional:  { label: '情感性任务', color: '#ec4899', bg: 'bg-pink-50' },
  social:     { label: '社会性任务', color: '#10b981', bg: 'bg-emerald-50' },
};

export interface IntentStat {
  stage: UserIntentStage;
  count: number;
  totalVolume: number;
  avgCpc: number;
  avgCvr: number;
  share: number; // 0-1 按词数占比
  volumeShare: number;
  topKeywords: string[];
}

export interface JTBDStat {
  job: string;
  jobType: JobType;
  count: number;
  totalVolume: number;
  avgCpc: number;
  avgCvr: number;
  avgDifficulty: number;
  topKeywords: string[];
  opportunityScore: number;
}

export interface RankItem {
  name: string;
  count: number;
  totalVolume: number;
  topKeywords: string[];
}

export interface ScenarioInsights {
  scenarios: RankItem[];
  users: RankItem[];
  painPoints: RankItem[];
  features: RankItem[];
  /** 场景 × 人群交叉：key = `${scenario}|||${user}` */
  crossMatrix: { scenario: string; user: string; count: number; volume: number }[];
}

export interface AiInsight {
  userPersona: string;
  userScenes: string[];
  userNeeds: string[];
  userPainPoints: string[];
  decisionStages: { name: string; desc: string; signals: string }[];
  decisionSummary: string;
  insightAnalysis: string;
  listingPlan: { title: string; bullets: string[]; keywords: string; visual: string };
  productPlan: {
    core: string;
    differentiation: string;
    priceRange: string;
    mustFix: string[];
    /** 一个父体下如何设变体与优先级 */
    parentStructure?: {
      summary: string;
      variants: { name: string; role: string; priority: string; rationale: string }[];
    };
  };
  productRoadmap: { phase: string; name: string; target: string; priority: string; rationale?: string }[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function calcOpportunityScore(
  avgCpc: number, avgCvr: number, totalVolume: number, maxVolume: number,
  avgDifficulty: number
): number {
  const cpa = (!avgCvr || avgCvr <= 0) ? 999 : avgCpc / avgCvr;
  const cpaScore = cpa >= 999 ? 0 : clamp01((30 - cpa) / 25);
  const cvrScore = clamp01(avgCvr / 0.15);
  const demandScore = maxVolume > 0
    ? clamp01(Math.log10(totalVolume + 1) / Math.log10(maxVolume + 1))
    : 0;
  const easyScore = clamp01(1 - avgDifficulty / 100);
  return Math.round(35 * cvrScore + 25 * cpaScore + 25 * demandScore + 15 * easyScore);
}

function aggregateRank(
  kws: Keyword[],
  getter: (k: Keyword) => string | undefined
): RankItem[] {
  const map = new Map<string, Keyword[]>();
  kws.forEach(k => {
    const name = (getter(k) || '').trim();
    if (!name) return;
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(k);
  });
  return [...map.entries()]
    .map(([name, list]) => ({
      name,
      count: list.length,
      totalVolume: list.reduce((s, k) => s + k.weeklySearchVolume, 0),
      topKeywords: [...list]
        .sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume)
        .slice(0, 5)
        .map(k => k.keyword),
    }))
    .sort((a, b) => b.totalVolume - a.totalVolume);
}

/** 购买意图阶段统计 */
export function calcIntentStats(kws: Keyword[]): IntentStat[] {
  const stages: UserIntentStage[] = ['awareness', 'consideration', 'decision', 'loyalty'];
  const total = kws.filter(k => k.userIntentStage).length || 1;
  const totalVol = kws.reduce((s, k) => s + (k.userIntentStage ? k.weeklySearchVolume : 0), 0) || 1;

  return stages.map(stage => {
    const list = kws.filter(k => k.userIntentStage === stage);
    const tv = list.reduce((s, k) => s + k.weeklySearchVolume, 0);
    return {
      stage,
      count: list.length,
      totalVolume: tv,
      avgCpc: list.length ? list.reduce((s, k) => s + k.cpcBid, 0) / list.length : 0,
      avgCvr: list.length ? list.reduce((s, k) => s + k.conversionRate, 0) / list.length : 0,
      share: list.length / total,
      volumeShare: tv / totalVol,
      topKeywords: [...list]
        .sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume)
        .slice(0, 8)
        .map(k => k.keyword),
    };
  }).filter(s => s.count > 0);
}

/** JTBD 任务聚类统计 */
export function calcJTBDStats(kws: Keyword[]): JTBDStat[] {
  const map = new Map<string, Keyword[]>();
  kws.forEach(k => {
    const job = (k.jobToBeDone || '').trim();
    if (!job) return;
    if (!map.has(job)) map.set(job, []);
    map.get(job)!.push(k);
  });
  const volumes = [...map.values()].map(list => list.reduce((s, k) => s + k.weeklySearchVolume, 0));
  const maxVolume = volumes.length ? Math.max(...volumes) : 0;

  return [...map.entries()].map(([job, list]) => {
    const tv = list.reduce((s, k) => s + (Number(k.weeklySearchVolume) || 0), 0);
    const ac = list.reduce((s, k) => s + (Number(k.cpcBid) || 0), 0) / list.length;
    const acvr = list.reduce((s, k) => s + (Number(k.conversionRate) || 0), 0) / list.length;
    const ad = list.reduce((s, k) => s + (Number(k.difficulty) || 0), 0) / list.length;
    // 取该任务下出现最多的 jobType
    const typeCount: Record<string, number> = {};
    list.forEach(k => {
      const t = (k.jobType && JOB_TYPE_META[k.jobType as JobType] ? k.jobType : 'functional') as JobType;
      typeCount[t] = (typeCount[t] || 0) + 1;
    });
    const jobType = (Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'functional') as JobType;
    return {
      job,
      jobType,
      count: list.length,
      totalVolume: tv,
      avgCpc: ac,
      avgCvr: acvr,
      avgDifficulty: ad,
      topKeywords: [...list].sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume).slice(0, 5).map(k => k.keyword),
      opportunityScore: calcOpportunityScore(ac, acvr, tv, maxVolume, ad),
    };
  })
  .filter(j => j.count >= 3)  // 过滤碎片任务（< 3 个关键词的合并）
  .sort((a, b) => b.opportunityScore - a.opportunityScore);
}

/** 场景 / 人群 / 痛点 / 功能洞察 */
export function calcScenarioInsights(kws: Keyword[]): ScenarioInsights {
  const scenarios = aggregateRank(kws, k => k.useScenario);
  const users = aggregateRank(kws, k => k.targetUser);
  const painPoints = aggregateRank(kws, k => k.painPoint);
  const features = aggregateRank(kws, k => k.featureDemand);

  const crossMap = new Map<string, { scenario: string; user: string; count: number; volume: number }>();
  kws.forEach(k => {
    const s = (k.useScenario || '').trim();
    const u = (k.targetUser || '').trim();
    if (!s || !u) return;
    const key = `${s}|||${u}`;
    const cur = crossMap.get(key) || { scenario: s, user: u, count: 0, volume: 0 };
    cur.count += 1;
    cur.volume += k.weeklySearchVolume;
    crossMap.set(key, cur);
  });

  return {
    scenarios,
    users,
    painPoints,
    features,
    crossMatrix: [...crossMap.values()].sort((a, b) => b.volume - a.volume),
  };
}

/** 是否已完成用户洞察打标 */
export function hasInsightTags(kws: Keyword[]): boolean {
  return kws.some(k => k.userIntentStage || k.jobToBeDone || k.useScenario);
}

export function calcKwValueDensity(k: Keyword): number {
  return k.weeklySearchVolume * k.conversionRate;
}

export function exportKeywordsToExcel(keywords: Keyword[]) {
  const rows = keywords.map(k => ({
    '关键词': k.keyword,
    '翻译': k.translation,
    '购买意图': k.userIntentStage ? INTENT_META[k.userIntentStage].label : '',
    'JTBD任务': k.jobToBeDone || '',
    '任务类型': k.jobType ? JOB_TYPE_META[k.jobType].label : '',
    '使用场景': k.useScenario || '',
    '目标人群': k.targetUser || '',
    '痛点': k.painPoint || '',
    '功能需求': k.featureDemand || '',
    '对比对象': k.comparisonTarget || '',
    '细分方向': k.wordTag || '',
    '周搜索量': k.weeklySearchVolume,
    'CPC建议竞价': k.cpcBid,
    '点击转化率': k.conversionRate,
    '价值密度(周转化流量)': Number(calcKwValueDensity(k).toFixed(2)),
    '竞争难度': k.difficulty,
    'Top3点击份额': k.top3ClickShare,
    'AI标签': k.aiTags.join('、'),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '关键词用户洞察');

  const jobs = calcJTBDStats(keywords);
  if (jobs.length > 0) {
    const jobRows = jobs.map(j => ({
      '机会评分': j.opportunityScore,
      '用户任务': j.job,
      '任务类型': JOB_TYPE_META[j.jobType].label,
      '词数': j.count,
      '总周搜索量': j.totalVolume,
      '平均CPC': Number(j.avgCpc.toFixed(2)),
      '平均CVR(%)': Number((j.avgCvr * 100).toFixed(2)),
      '平均难度': Number(j.avgDifficulty.toFixed(1)),
      '代表词': j.topKeywords.join('、'),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(jobRows), 'JTBD任务评分');
  }

  const intents = calcIntentStats(keywords);
  if (intents.length > 0) {
    const intentRows = intents.map(i => ({
      '意图阶段': INTENT_META[i.stage].label,
      '词数': i.count,
      '词数占比': `${(i.share * 100).toFixed(1)}%`,
      '总周搜索量': i.totalVolume,
      '搜索量占比': `${(i.volumeShare * 100).toFixed(1)}%`,
      '平均CVR(%)': Number((i.avgCvr * 100).toFixed(2)),
      '代表词': i.topKeywords.join('、'),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(intentRows), '购买意图分布');
  }

  XLSX.writeFile(wb, `关键词用户洞察_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

const INTENT_VALUES: UserIntentStage[] = ['awareness', 'consideration', 'decision', 'loyalty'];
const JOB_TYPE_VALUES: JobType[] = ['functional', 'emotional', 'social'];

function normalizeIntent(raw: unknown): UserIntentStage | undefined {
  const s = String(raw || '').toLowerCase().trim();
  if (INTENT_VALUES.includes(s as UserIntentStage)) return s as UserIntentStage;
  if (s.includes('认知') || s.includes('aware')) return 'awareness';
  if (s.includes('考虑') || s.includes('consider')) return 'consideration';
  if (s.includes('决策') || s.includes('decision') || s.includes('购买')) return 'decision';
  if (s.includes('忠诚') || s.includes('loyalty') || s.includes('品牌')) return 'loyalty';
  return undefined;
}

function normalizeJobType(raw: unknown): JobType | undefined {
  const s = String(raw || '').toLowerCase().trim();
  if (JOB_TYPE_VALUES.includes(s as JobType)) return s as JobType;
  if (s.includes('功能') || s.includes('func')) return 'functional';
  if (s.includes('情感') || s.includes('emotion')) return 'emotional';
  if (s.includes('社会') || s.includes('social')) return 'social';
  return undefined;
}

interface Props {
  keywords: Keyword[];
  setKeywords: React.Dispatch<React.SetStateAction<Keyword[]>>;
  marketplaceCode?: string;
  suggestAsins?: string[];
  /** 示例数据预置的 AI 用户洞察报告 */
  initialInsight?: AiInsight | null;
  /** App 层持久化的关键词报告 */
  persistedInsight?: AiInsight | null;
  /** 历史快照/IndexedDB 恢复时递增，强制灌入持久化报告 */
  insightRestoreKey?: number;
  onInsightSync?: (state: AiInsight | null) => void;
}

export const KeywordAnalysis = React.memo(function KeywordAnalysis({
  keywords,
  setKeywords,
  marketplaceCode = 'US',
  suggestAsins = [],
  initialInsight = null,
  persistedInsight = null,
  insightRestoreKey = 0,
  onInsightSync,
}: Props) {
  const [isAI, setIsAI] = useState(false);
  const [prog, setProg] = useState({ c: 0, t: 0 });
  const [q, setQ] = useState('');
  const [eid, setEid] = useState<string | null>(null);
  const [etags, setEtags] = useState<string[]>([]);
  const [cat, setCat] = useState('all');
  const [seg, setSeg] = useState<string | null>(null);
  const [tab, setTab] = useState<'intent' | 'jtbd' | 'scenario' | 'report'>(
    () => (persistedInsight || initialInsight ? 'report' : 'intent')
  );
  const [ins, setIns] = useState<AiInsight | null>(() => persistedInsight ?? initialInsight ?? null);
  const [genIns, setGenIns] = useState(false);
  const [showT, setShowT] = useState(false);
  const [seedHint, setSeedHint] = useState('');
  const abort = useRef<AbortController | null>(null);
  const lastInsightRestoreKey = useRef(0);

  useEffect(() => {
    if (!initialInsight) return;
    if (persistedInsight) return;
    setIns(initialInsight);
  }, [initialInsight, persistedInsight]);

  useEffect(() => {
    if (!insightRestoreKey || insightRestoreKey === lastInsightRestoreKey.current) return;
    lastInsightRestoreKey.current = insightRestoreKey;
    setIns(persistedInsight ?? initialInsight ?? null);
    if (persistedInsight || initialInsight) setTab('report');
  }, [initialInsight, insightRestoreKey, persistedInsight]);

  const hasInsight = useMemo(() => hasInsightTags(keywords), [keywords]);
  const intentStats = useMemo(() => hasInsight ? calcIntentStats(keywords) : [], [keywords, hasInsight]);
  const jtbdStats = useMemo(() => hasInsight ? calcJTBDStats(keywords) : [], [keywords, hasInsight]);
  const scenarioInsights = useMemo(() => hasInsight ? calcScenarioInsights(keywords) : {
    scenarios: [], users: [], painPoints: [], features: [], crossMatrix: [],
  }, [keywords, hasInsight]);
  const totVol = useMemo(() => keywords.reduce((s, k) => s + k.weeklySearchVolume, 0), [keywords]);
  const tStat = useMemo(() => {
    const c: Record<string, number> = {}, v: Record<string, number> = {};
    TAGS.forEach(t => { c[t] = 0; v[t] = 0; });
    keywords.forEach(k => k.aiTags.forEach(t => {
      if (c[t] !== undefined) { c[t]++; v[t] += k.weeklySearchVolume; }
    }));
    return TAGS.map(n => ({ name: n, count: c[n], vol: v[n] })).filter(s => s.count > 0).sort((a, b) => b.count - a.count);
  }, [keywords]);
  const filt = useMemo(() => keywords.filter(k => {
    const ms = k.keyword.toLowerCase().includes(q.toLowerCase()) || k.translation.toLowerCase().includes(q.toLowerCase());
    return ms && (cat === 'all' || k.aiTags.includes(cat)) && (!seg || k.jobToBeDone === seg || k.useScenario === seg || k.userIntentStage === seg);
  }), [keywords, q, cat, seg]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const d = await parseKeywords(f);
      setKeywords(d);
      setSeg(null);
      setIns(null);
      onInsightSync?.(null);
      toast.success(`已导入 ${d.length} 个关键词`);
    } catch {
      toast.error('解析失败，请检查格式。');
    }
    e.target.value = '';
  };

  const handleMcpFetchKeywords = async (params: {
    asins: string[];
    seedKeyword?: string;
    keywordSource?: KeywordFetchSource;
    marketplace: string;
    maxPages: number;
    replace: boolean;
    onProgress: (msg: string) => void;
  }) => {
    const all: Keyword[] = [];
    const seen = new Set<string>();

    if (params.keywordSource === 'seed' && params.seedKeyword?.trim()) {
      const seed = params.seedKeyword.trim();
      params.onProgress(`抓取「${seed}」ABA 关联词…`);
      const chunk = await fetchKeywordsByKeywordFromMcp({
        keyword: seed,
        marketplace: params.marketplace,
        maxPages: params.maxPages,
        onProgress: params.onProgress,
      });
      for (const k of chunk) {
        const key = k.keyword.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(k);
      }
      setSeedHint(seed);
      if (!all.length) {
        toast.error('未抓到关键词，请换词/站点后重试');
        throw new Error('未抓到关键词');
      }
      setKeywords(prev => {
        if (params.replace) return all;
        const exist = new Set(prev.map(k => k.keyword.toLowerCase()));
        return [...prev, ...all.filter(k => !exist.has(k.keyword.toLowerCase()))];
      });
      setSeg(null);
      setIns(null);
      onInsightSync?.(null);
      toast.success(`已从 ABA 抓取 ${all.length} 个关联词（种子词：${seed}）`);
      return;
    }

    for (let i = 0; i < params.asins.length; i++) {
      const asin = params.asins[i];
      params.onProgress(`(${i + 1}/${params.asins.length}) 抓取 ${asin} 流量词…`);
      const chunk = await fetchKeywordsFromMcp({
        asin,
        marketplace: params.marketplace,
        maxPages: params.maxPages,
        onProgress: params.onProgress,
      });
      for (const k of chunk) {
        const key = k.keyword.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(k);
      }
    }
    if (!all.length) {
      toast.error('未抓到关键词，请换 ASIN/站点后重试');
      throw new Error('未抓到关键词');
    }
    setKeywords(prev => {
      if (params.replace) return all;
      const exist = new Set(prev.map(k => k.keyword.toLowerCase()));
      return [...prev, ...all.filter(k => !exist.has(k.keyword.toLowerCase()))];
    });
    setSeg(null);
    setIns(null);
    onInsightSync?.(null);
    toast.success(`已从卖家精灵抓取 ${all.length} 个关键词（${params.asins.length} 个 ASIN）`);
  };

  const runAI = async () => {
    if (!keywords.length) return;
    const cfg = loadAiSettings();
    if (!cfg?.apiKey) { toast.error('请先配置 API Key'); return; }
    setIsAI(true);
    abort.current = new AbortController();
    try {
      // Step 1: 提取品类主题
      setProg({ c: 1, t: 2 });
      const sortedByVol = [...keywords].sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume);
      const sampleTop = sortedByVol.slice(0, 40);
      const themePrompt = `你是亚马逊用户洞察专家。根据以下关键词样本，用一句话说明这批词对应的产品品类与典型用户是谁。
种子词提示：${seedHint || '（无）'}
样本：
${sampleTop.map((k, i) => `${i + 1}. ${k.keyword}（${k.translation}，搜索量:${k.weeklySearchVolume}）`).join('\n')}

返回 JSON：{"category":"品类名","persona":"典型用户一句话","theme":"核心使用场景一句话"}`;

      let categoryHint = '';
      try {
        const themeRes = await generateText(themePrompt, cfg, { jsonMode: true });
        const tm = themeRes.match(/\{.*\}/s);
        const tj = JSON.parse(tm ? tm[0] : themeRes);
        categoryHint = `品类：${tj.category || ''}；用户：${tj.persona || ''}；场景：${tj.theme || ''}`;
        toast.info(`已识别品类：${tj.category || '未知'}，开始三合一洞察标注…`);
      } catch {
        toast.info('品类识别跳过，直接开始洞察标注…');
      }

      // Step 2: 三合一批量打标
      const bs = 25;
      const CONCURRENCY = 4;
      const MAX_RETRY = 1;
      const batches: Keyword[][] = [];
      for (let i = 0; i < keywords.length; i += bs) batches.push(keywords.slice(i, i + bs));
      const tot = batches.length;
      setProg({ c: 0, t: tot });

      const buildPrompt = (batch: Keyword[]) => `你是亚马逊用户洞察专家。对以下关键词做「三合一」标注。背景：${categoryHint || '未知品类'}

【分析 1：购买意图分层 intent】
必须从以下 4 个英文值中选一个：
- awareness：问题认知、how/what/why、信息收集、痛点描述（例：how to sleep better、neck pain pillow）
- consideration：对比/筛选/属性限定、best/top/for/vs、评测比较（例：best cooling pillow、memory foam vs latex）
- decision：购买行动、规格精确、颜色尺寸价格限定、型号/buy now（例：2 inch thin pillow queen、buy cervical pillow）
- loyalty：品牌词、复购、replacement、配件/耗材（例：品牌名 + pillow、replacement cover）

硬规则示例：
- 含 how / what is / why → 优先 awareness
- 含 best / top / vs / for / review → 优先 consideration
- 含明确尺寸/颜色/数量/价格/buy/型号 → 优先 decision
- 含品牌名 / replacement / refill → 优先 loyalty
冲突时优先级：decision > consideration > loyalty > awareness
非法或空值时填 consideration（不要留空）

【分析 2：JTBD 用户任务】
- job：结果导向的短标签，2-8 个中文字，写「用户要完成什么结果」（如「便携携带」「隔音降噪」「送礼表达」），禁止只写泛品类词（如「枕头」「产品」）。
- 同类关键词必须共用同一任务名；尽量用 5-8 个任务覆盖本批，不要一词一任务。
- jobType：functional（功能）/ emotional（情感）/ social（社会）。整批评分时应尽量三类都有覆盖（若证据不足可空）。
若关键词只是泛品类词、无明显任务，job 与 jobType 可留空字符串。

【分析 3：场景 / 人群 / 痛点 / 功能】（字段互不串台）
- scenario：只能是使用情境（地点/时刻/活动，如「侧睡」「差旅」「居家办公」）。禁止把痛点或功能写进 scenario。
- user：目标人群（儿童/女性/老年人/专业人士等），无则空字符串。
- pain：必须是问题表述（难清洗/异味/塌陷等），禁止写成功能卖点。
- feature：必须是产品属性/能力（可折叠/静音/防水等），禁止写成痛点。
- compare：对比对象（若含 vs / alternative），无则空字符串。
- tags：从【人群词、场景词、品牌词、尺寸词、数量词、颜色词、材质词、功能词】中选 0-3 个。
同批内近义标签请合并为同一写法；证据不足允许空字段，禁止编造。

关键词列表：
${batch.map((k, n) => `${n + 1}. ${k.keyword}（${k.translation}）`).join('\n')}

严格返回 JSON 数组，keyword 必须原样回写：
[{"keyword":"原词","intent":"consideration","job":"便携携带","jobType":"functional","scenario":"户外","user":"","pain":"","feature":"可折叠","compare":"","tags":["场景词","功能词"]}]`;

      const processBatch = async (batch: Keyword[]): Promise<{ ok: boolean }> => {
        for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
          if (abort.current?.signal.aborted) return { ok: false };
          try {
            const r = await generateText(buildPrompt(batch), cfg, { jsonMode: true });
            const m = r.match(/\[.*\]/s);
            const rs = JSON.parse(m ? m[0] : r);
            if (!Array.isArray(rs)) throw new Error('非数组');
            setKeywords(prev => {
              const next = [...prev];
              rs.forEach((row: any) => {
                const idx = next.findIndex(k => k.keyword === row.keyword);
                if (idx === -1) return;
                const intent = normalizeIntent(row.intent) || 'consideration';
                const jobType = normalizeJobType(row.jobType);
                const job = String(row.job || '').trim();
                const scenario = String(row.scenario || '').trim();
                next[idx] = {
                  ...next[idx],
                  userIntentStage: intent,
                  jobToBeDone: job || next[idx].jobToBeDone,
                  jobType: jobType || next[idx].jobType,
                  useScenario: scenario || next[idx].useScenario,
                  targetUser: String(row.user || '').trim() || next[idx].targetUser,
                  painPoint: String(row.pain || '').trim() || next[idx].painPoint,
                  featureDemand: String(row.feature || '').trim() || next[idx].featureDemand,
                  comparisonTarget: String(row.compare || '').trim() || next[idx].comparisonTarget,
                  wordTag: job || scenario || next[idx].wordTag,
                  aiTags: Array.isArray(row.tags)
                    ? row.tags.filter((t: string) => TAGS.includes(t))
                    : next[idx].aiTags,
                };
              });
              return next;
            });
            return { ok: true };
          } catch (e) {
            console.error(`[洞察打标] 第${attempt + 1}次失败:`, e);
            if (attempt < MAX_RETRY) await new Promise(r => setTimeout(r, 800));
          }
        }
        return { ok: false };
      };

      const queue = [...batches];
      let done = 0;
      let failed = 0;
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          if (abort.current?.signal.aborted) return;
          const batch = queue.shift();
          if (!batch) return;
          const res = await processBatch(batch);
          if (!res.ok) failed++;
          done++;
          setProg({ c: done, t: tot });
        }
      });
      await Promise.all(workers);

      if (abort.current?.signal.aborted) return;
      if (failed > 0) toast.warning(`用户洞察分析完成（${failed}/${tot} 批失败，可重试）`);
      else toast.success('用户洞察分析完成！');
      setTab('intent');
    } catch (e) {
      toast.error(`出错: ${e instanceof Error ? e.message : ''}`);
    } finally {
      setIsAI(false);
      setProg({ c: 0, t: 0 });
    }
  };

  const stop = () => { abort.current?.abort(); setIsAI(false); toast.info('已取消'); };

  const genAI = async () => {
    const cfg = loadAiSettings();
    if (!cfg?.apiKey) { toast.error('请先配置 API Key'); return; }
    setGenIns(true);
    try {
      const intents = calcIntentStats(keywords);
      const jobs = calcJTBDStats(keywords);
      const sc = calcScenarioInsights(keywords);
      const top = [...keywords].sort((a, b) => b.weeklySearchVolume - a.weeklySearchVolume).slice(0, 30);
      const baseInsight = getPrompt('user_insights') || '你是亚马逊用户洞察专家。基于关键词洞察数据，生成结构化用户洞察报告。';
      const p = `${baseInsight}

---

## 本次关键词洞察数据（请严格基于以下统计）

【购买意图分布】
${intents.map(i => `- ${INTENT_META[i.stage].label}：词数${i.count}（${(i.share * 100).toFixed(0)}%），搜索量${i.totalVolume.toLocaleString()}，均CPC $${i.avgCpc.toFixed(2)}，CVR ${(i.avgCvr * 100).toFixed(1)}%`).join('\n')}

【用户任务 JTBD Top】
${jobs.slice(0, 8).map(j => `- ${j.job}（${JOB_TYPE_META[j.jobType].label}）：量${j.totalVolume.toLocaleString()}，词${j.count}，机会分${j.opportunityScore}，CPC $${j.avgCpc.toFixed(2)}，CVR ${(j.avgCvr * 100).toFixed(1)}%`).join('\n')}

【高频场景】${sc.scenarios.slice(0, 5).map(s => `${s.name}(${s.totalVolume.toLocaleString()})`).join('、') || '无'}
【高频人群】${sc.users.slice(0, 5).map(s => `${s.name}(${s.totalVolume.toLocaleString()})`).join('、') || '无'}
【高频痛点】${sc.painPoints.slice(0, 5).map(s => `${s.name}(${s.totalVolume.toLocaleString()})`).join('、') || '无'}
【高频功能】${sc.features.slice(0, 5).map(s => `${s.name}(${s.totalVolume.toLocaleString()})`).join('、') || '无'}

【Top30 关键词】${top.map(k => `${k.keyword}(${k.translation},${k.weeklySearchVolume})`).join('，')}

## 输出格式（必须严格遵守）
请只返回一个 JSON 对象（不要 Markdown 代码围栏），不要输出 summary 字段：
{
  "userPersona":"120字用户画像：谁在买、谁在用、购买触发",
  "userScenes":["场景1","场景2","场景3"],
  "userNeeds":["需求1","需求2","需求3"],
  "userPainPoints":["痛点1","痛点2","痛点3"],
  "decisionStages":[{"name":"认知","desc":"该阶段用户在做什么","signals":"对应搜索信号/关键词类型"}],
  "decisionSummary":"80-120字决策路径总述",
  "insightAnalysis":"200-300字综合洞察：把画像、任务、痛点、路径串成可拍板判断",
  "listingPlan":{"title":"标题方向","bullets":["五点素材1","五点素材2","五点素材3"],"keywords":"核心词/长尾/防御词布局","visual":"主图与A+视觉策略"},
  "productPlan":{"core":"核心规格与功能组合","differentiation":"差异化方向","priceRange":"建议价格带","mustFix":["必改项1","必改项2"],"parentStructure":{"summary":"一个父体怎么铺变体的总原则","variants":[{"name":"主推变体","role":"流量锚点","priority":"P0","rationale":"为何先做"}]}},
  "productRoadmap":[{"phase":"P1","name":"产品线名称","target":"目标人群","priority":"高/中","rationale":"为何此时做、验证什么"}]
}`;
      const r = await generateText(p, cfg, { jsonMode: true });
      const m = r.match(/\{.*\}/s);
      const next = JSON.parse(m ? m[0] : r) as AiInsight;
      setIns(next);
      onInsightSync?.(next);
      setTab('report');
    } catch (e) {
      toast.error(`失败: ${e instanceof Error ? e.message : ''}`);
    } finally {
      setGenIns(false);
    }
  };

  const clear = () => {
    setKeywords([]);
    setQ('');
    setSeg(null);
    setIns(null);
    onInsightSync?.(null);
    setTab('intent');
    setSeedHint('');
  };
  const startEdit = (kw: Keyword) => { setEid(kw.id); setEtags(kw.aiTags); };
  const saveEdit = (id: string) => {
    setKeywords(p => p.map(k => k.id === id ? { ...k, aiTags: etags } : k));
    setEid(null);
  };
  const togTag = (t: string) => setEtags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);
  const onExport = () => { exportKeywordsToExcel(keywords); toast.success('导出成功'); };

  return (
    <KwView
      keywords={keywords}
      hasInsight={hasInsight}
      intentStats={intentStats}
      jtbdStats={jtbdStats}
      scenarioInsights={scenarioInsights}
      tStat={tStat}
      filt={filt}
      totVol={totVol}
      isAI={isAI}
      prog={prog}
      tab={tab}
      setTab={setTab}
      seg={seg}
      setSeg={setSeg}
      ins={ins}
      genIns={genIns}
      showT={showT}
      setShowT={setShowT}
      q={q}
      setQ={setQ}
      cat={cat}
      setCat={setCat}
      eid={eid}
      etags={etags}
      seedHint={seedHint}
      onUpload={upload}
      onRunAI={runAI}
      onStop={stop}
      onGenAI={genAI}
      onSaveInsight={() => {
        if (!ins) return;
        onInsightSync?.(ins);
        toast.success('已保存关键词报告，下次打开会自动恢复。');
      }}
      onClear={clear}
      onExport={onExport}
      onStartEdit={startEdit}
      onSaveEdit={saveEdit}
      onCancelEdit={() => setEid(null)}
      onTogTag={togTag}
      headerExtra={
        <McpFetchPanel
          mode="keywords"
          defaultMarketplace={marketplaceCode}
          suggestAsins={suggestAsins}
          defaultKeywordSource="seed"
          onFetch={handleMcpFetchKeywords}
        />
      }
    />
  );
});
