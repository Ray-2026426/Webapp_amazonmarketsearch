import React, { useState, useMemo, useRef } from 'react';
import { Keyword, parseKeywords } from '../utils/parser';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { toast } from 'sonner';
import { KwView } from './KeywordAnalysisView';
import * as XLSX from 'xlsx';

export const TAGS = ['人群词','场景词','品牌词','尺寸词','数量词','颜色词','材质词','功能词'];
export const SC = ['#4f46e5','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#14b8a6','#a855f7','#0ea5e9','#d946ef','#22c55e','#f43f5e','#fb923c','#facc15','#4ade80','#38bdf8','#c084fc'];

export interface QuadrantRule {
  highVolLabel: string;
  lowVolLabel: string;
  highCpcLabel: string;
  lowCpcLabel: string;
}

export const DEFAULT_QUADRANT_RULE: QuadrantRule = {
  highVolLabel: '高需求（周搜索量 ≥ 中位数）',
  lowVolLabel: '低需求（周搜索量 < 中位数）',
  highCpcLabel: '高竞争（平均CPC ≥ 中位数）',
  lowCpcLabel: '低竞争（平均CPC < 中位数）',
};

export const QI: Record<string,{label:string;color:string;bg:string;desc:string}> = {
  '黄金机会':{label:'黄金机会',color:'#10b981',bg:'bg-emerald-50',desc:'高需求×低竞争，优先进入'},
  '红海市场':{label:'红海市场',color:'#ef4444',bg:'bg-rose-50',desc:'高需求×高竞争，需差异化'},
  '长尾蓝海':{label:'长尾蓝海',color:'#3b82f6',bg:'bg-blue-50',desc:'低需求×低竞争，小而美'},
  '陷阱区':{label:'陷阱区',color:'#f59e0b',bg:'bg-amber-50',desc:'低需求×高竞争，谨慎'},
};

export interface SegStat {
  segment:string; count:number; totalVolume:number;
  avgCpc:number; avgCvr:number; avgDifficulty:number;
  topKeywords:string[]; quadrant:string;
  valueDensity:number;       // 价值密度 = 总搜索量 × 平均CVR（每周可转化流量）
  avgTop3ClickShare:number;  // 平均 Top3 点击份额（衡量头部集中度）
  opportunityScore:number;   // 机会评分 0-100（利润优先，不依赖售价）
  scoreReason:string;        // 评分一句话解读
}
export interface AiInsight {
  summary:string;
  topOpportunities:{segment:string;reason:string}[];
  whitespace:string;
  userPainPoints:string;
}

const clamp01 = (v:number) => Math.max(0, Math.min(1, v));

/** 机会评分（利润优先，不依赖售价）
 *  ① CVR 表现     35%：CVR ≥ 15% 满分（用户买的多 = 容易赚钱）
 *  ② CPA 友好度   25%：CPA = CPC/CVR，$5 满分 / $30 零分（每成交一单的广告成本）
 *  ③ 需求量级     20%：相对最大细分的搜索量（对数归一）
 *  ④ 头部分散度   10%：Top3 点击份额越低越好（数据缺失给中性 0.5）
 *  ⑤ 易入场难度   10%：难度越低越好
 */
function calcOpportunityScore(
  avgCpc:number, avgCvr:number, totalVolume:number, maxVolume:number,
  avgTop3:number, avgDifficulty:number
): number {
  // CPA = CPC ÷ CVR，单位：每成交一单的广告费（美元）
  const cpa = (!avgCvr || avgCvr <= 0) ? 999 : avgCpc / avgCvr;
  const cpaScore  = cpa >= 999 ? 0 : clamp01((30 - cpa) / 25); // $5→1，$30→0
  const cvrScore  = clamp01(avgCvr / 0.15);
  const demandScore = maxVolume > 0
    ? clamp01(Math.log10(totalVolume + 1) / Math.log10(maxVolume + 1))
    : 0;
  const dispScore = avgTop3 > 0 ? clamp01(1 - avgTop3) : 0.5;
  const easyScore = clamp01(1 - avgDifficulty / 100);
  const score = 35*cvrScore + 25*cpaScore + 20*demandScore + 10*dispScore + 10*easyScore;
  return Math.round(score);
}

/** 评分对应一句话推荐（结合象限） */
function buildScoreReason(score:number, quadrant:string, avgCvr:number, avgDifficulty:number): string {
  const cvrTxt = avgCvr > 0 ? `CVR ${(avgCvr*100).toFixed(1)}%` : '转化数据不足';
  const diffTxt = avgDifficulty <= 40 ? '易入场' : avgDifficulty <= 70 ? '中难度' : '高难度';
  if (score >= 75) return `强烈推荐｜${quadrant}｜${cvrTxt} · ${diffTxt}，建议优先布局`;
  if (score >= 60) return `值得做｜${quadrant}｜${cvrTxt} · ${diffTxt}，综合表现良好`;
  if (score >= 45) return `可考虑｜${quadrant}｜${cvrTxt} · ${diffTxt}，有亮点也有短板`;
  return `谨慎入场｜${quadrant}｜${cvrTxt} · ${diffTxt}，性价比偏弱`;
}

export function calcSegs(kws: Keyword[]): SegStat[] {
  const map = new Map<string, Keyword[]>();
  kws.forEach(k => {
    const s = k.wordTag?.trim() || '未分类';
    if (!map.has(s)) map.set(s, []);
    map.get(s)!.push(k);
  });
  const vs = [...map.values()].map(ks => ks.reduce((s,k) => s+k.weeklySearchVolume, 0)).sort((a,b) => a-b);
  const cs = [...map.values()].map(ks => ks.reduce((s,k) => s+k.cpcBid, 0)/ks.length).sort((a,b) => a-b);
  const mv = vs[Math.floor(vs.length/2)] || 0;
  const mc = cs[Math.floor(cs.length/2)] || 0;
  const maxVolume = vs.length ? vs[vs.length-1] : 0;

  const out: SegStat[] = [];
  map.forEach((ks, seg) => {
    const tv = ks.reduce((s,k) => s+k.weeklySearchVolume, 0);
    const ac = ks.reduce((s,k) => s+k.cpcBid, 0) / ks.length;
    const acvr = ks.reduce((s,k) => s+k.conversionRate, 0) / ks.length;
    const ad = ks.reduce((s,k) => s+k.difficulty, 0) / ks.length;
    const at3 = ks.reduce((s,k) => s+(k.top3ClickShare||0), 0) / ks.length;
    const tk = [...ks].sort((a,b) => b.weeklySearchVolume-a.weeklySearchVolume).slice(0,5).map(k => k.keyword);
    const hv = tv >= mv, hc = ac >= mc;
    const quadrant = hv&&!hc ? '黄金机会' : hv&&hc ? '红海市场' : !hv&&!hc ? '长尾蓝海' : '陷阱区';
    const valueDensity = tv * acvr;
    const score = calcOpportunityScore(ac, acvr, tv, maxVolume, at3, ad);
    const reason = buildScoreReason(score, quadrant, acvr, ad);

    out.push({
      segment:seg, count:ks.length, totalVolume:tv,
      avgCpc:ac, avgCvr:acvr, avgDifficulty:ad,
      topKeywords:tk, quadrant,
      valueDensity, avgTop3ClickShare:at3,
      opportunityScore:score, scoreReason:reason,
    });
  });
  return out.sort((a,b) => b.opportunityScore - a.opportunityScore);
}

/** 单个关键词的价值密度（用于词表新增列） */
export function calcKwValueDensity(k: Keyword): number {
  return k.weeklySearchVolume * k.conversionRate;
}

export function exportKeywordsToExcel(keywords: Keyword[]) {
  const rows = keywords.map(k => ({
    '关键词': k.keyword,
    '翻译': k.translation,
    '细分方向': k.wordTag || '',
    '周搜索量': k.weeklySearchVolume,
    'CPC建议竞价': k.cpcBid,
    '点击转化率': k.conversionRate,
    '价值密度(周转化流量)': Number(calcKwValueDensity(k).toFixed(2)),
    '竞争难度': k.difficulty,
    '自然位滚动率': k.organicScrollRate,
    'Top3点击份额': k.top3ClickShare,
    'Top3转化份额': k.top3ConversionShare,
    'Top3 ASIN': k.top3Asins,
    'AI标签': k.aiTags.join('、'),
    '匹配方式': k.matchType,
    '相关性档位': k.relevanceTier,
    '竞争难度档位': k.difficultyTier,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '关键词分析');

  const segs = calcSegs(keywords);
  if (segs.length > 0) {
    const segRows = segs.map(s => ({
      '机会评分': s.opportunityScore,
      '细分方向': s.segment,
      '象限': s.quadrant,
      '词数': s.count,
      '总周搜索量': s.totalVolume,
      '平均CPC': Number(s.avgCpc.toFixed(2)),
      '平均CVR(%)': Number((s.avgCvr*100).toFixed(2)),
      '价值密度': Number(s.valueDensity.toFixed(2)),
      '平均难度': Number(s.avgDifficulty.toFixed(1)),
      'Top3点击份额': Number((s.avgTop3ClickShare*100).toFixed(2)),
      '代表词': s.topKeywords.join('、'),
      '一句话解读': s.scoreReason,
    }));
    const ws2 = XLSX.utils.json_to_sheet(segRows);
    XLSX.utils.book_append_sheet(wb, ws2, '细分机会评分');
  }

  XLSX.writeFile(wb, `关键词分析_${new Date().toISOString().slice(0,10)}.xlsx`);
}

interface Props { keywords: Keyword[]; setKeywords: React.Dispatch<React.SetStateAction<Keyword[]>>; }

export const KeywordAnalysis = React.memo(function KeywordAnalysis({ keywords, setKeywords }: Props) {
  const [isAI, setIsAI]     = useState(false);
  const [prog, setProg]     = useState({ c: 0, t: 0 });
  const [q, setQ]           = useState('');
  const [eid, setEid]       = useState<string | null>(null);
  const [etags, setEtags]   = useState<string[]>([]);
  const [cat, setCat]       = useState('all');
  const [seg, setSeg]       = useState<string | null>(null);
  const [tab, setTab]       = useState<'ov'|'qd'|'dd'|'ai'>('ov');
  const [ins, setIns]       = useState<AiInsight | null>(null);
  const [genIns, setGenIns] = useState(false);
  const [showT, setShowT]   = useState(false);
  const [maxSegs, setMaxSegs] = useState(12);
  const [quadrantRule, setQuadrantRule] = useState<QuadrantRule>(DEFAULT_QUADRANT_RULE);
  const abort = useRef<AbortController | null>(null);

  const hasSeg = useMemo(() => keywords.some(k => k.wordTag?.trim()), [keywords]);
  const segs   = useMemo(() => hasSeg ? calcSegs(keywords) : [], [keywords, hasSeg]);
  const totVol = useMemo(() => keywords.reduce((s,k) => s+k.weeklySearchVolume, 0), [keywords]);
  const scat   = useMemo(() => segs.map((s,i) => ({ ...s, x:s.totalVolume, y:s.avgCpc, z:Math.max(s.count*6,80), color:SC[i%SC.length] })), [segs]);
  const tStat  = useMemo(() => {
    const c: Record<string,number> = {}, v: Record<string,number> = {};
    TAGS.forEach(t => { c[t]=0; v[t]=0; });
    keywords.forEach(k => k.aiTags.forEach(t => { if(c[t]!==undefined){ c[t]++; v[t]+=k.weeklySearchVolume; } }));
    return TAGS.map(n => ({ name:n, count:c[n], vol:v[n] })).filter(s => s.count>0).sort((a,b) => b.count-a.count);
  }, [keywords]);
  const filt = useMemo(() => keywords.filter(k => {
    const ms = k.keyword.toLowerCase().includes(q.toLowerCase()) || k.translation.toLowerCase().includes(q.toLowerCase());
    return ms && (cat==='all' || k.aiTags.includes(cat)) && (!seg || k.wordTag?.trim()===seg);
  }), [keywords, q, cat, seg]);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { const d = await parseKeywords(f); setKeywords(d); setSeg(null); setIns(null); toast.success(`已导入 ${d.length} 个关键词`); }
    catch { toast.error('解析失败，请检查格式。'); }
    e.target.value = '';
  };

  const runAI = async () => {
    if (!keywords.length) return;
    const cfg = loadAiSettings();
    if (!cfg?.apiKey) { toast.error('请先配置 API Key'); return; }
    setIsAI(true); abort.current = new AbortController();
    try {
      // 第一步：让 AI 规划细分（统一维度 + 抽样覆盖头尾）
      const limit = maxSegs;
      setProg({ c: 1, t: 2 });

      // 抽样：取搜索量 Top 60 + 中间 30 + 长尾 20，避免只看头部
      const sortedByVol = [...keywords].sort((a,b) => b.weeklySearchVolume - a.weeklySearchVolume);
      const total = sortedByVol.length;
      const sampleSet = new Set<number>();
      for (let i = 0; i < Math.min(60, total); i++) sampleSet.add(i);
      const midStart = Math.floor(total * 0.4);
      for (let i = midStart; i < Math.min(midStart + 30, total); i++) sampleSet.add(i);
      for (let i = Math.max(0, total - 20); i < total; i++) sampleSet.add(i);
      const sample = [...sampleSet].sort((a,b) => a-b).map(i => sortedByVol[i]);

      const planPrompt = `你是资深亚马逊选品研究专家。请把以下${keywords.length}个关键词归并成「细分方向」名单。

【核心规则 - 必须严格遵守】
所有细分名必须围绕同一种"产品特征维度"来命名，绝对不能混用维度。允许的维度只有以下 5 类：
  ① 产品形态/品类（如：折叠款、便携款、台式款、桌面款）
  ② 使用场景（如：办公场景、户外场景、厨房场景、车载场景）
  ③ 目标人群（如：儿童专用、女性专用、宠物专用、老年人）
  ④ 材质/工艺（如：硅胶款、不锈钢款、木质款）
  ⑤ 功能特性（如：防水款、可调节款、静音款、智能款）

【严格禁止 - 出现即视为失败】
× 不能用"机会评价词"作为细分名：黄金机会、热门、蓝海、红海、潜力、新兴、爆款、明星
× 不能用"程度评价词"：高端、低端、高频、低价、高质量、热销
× 不能用"通用品类总称"：相关产品、其他、综合类、常规款
× 不能混合维度（同一批细分里不能既有"折叠款"又有"户外场景"，必须二选一）

【输出要求】
1. 数量 6-${limit} 个（少而精，相似的必须合并）
2. 每个名称 2-8 个中文字
3. 选择最能体现这批词差异的那一个维度，所有细分名都用这个维度
4. 覆盖 80%+ 的关键词

关键词样本（已包含头部/中部/长尾共 ${sample.length} 个）：
${sample.map((k, n) => `${n+1}. ${k.keyword}（${k.translation}，搜索量:${k.weeklySearchVolume}）`).join('\n')}

先在 reasoning 字段说明你选了哪个维度（一句话），再在 segments 字段返回名单。
返回JSON：{"reasoning":"选了X维度，因为...","segments":["细分名1","细分名2",...]}`;

      const planRes = await generateText(planPrompt, cfg, { jsonMode: true });
      const planMatch = planRes.match(/\{.*\}/s);
      let segNames: string[] = [];
      try {
        const planJson = JSON.parse(planMatch ? planMatch[0] : planRes);
        segNames = Array.isArray(planJson.segments) ? planJson.segments : [];
      } catch { segNames = []; }

      // 兜底清洗：过滤掉明显的"机会评价词"，确保细分名维度一致
      const BANNED_SUBSTRINGS = ['黄金机会','机会','蓝海','红海','热门','潜力','新兴','爆款','明星品','高端','低端','其他','综合','相关产品','常规','通用'];
      segNames = segNames
        .map(s => String(s).trim())
        .filter(s => s.length >= 2 && s.length <= 12)
        .filter(s => !BANNED_SUBSTRINGS.some(b => s.includes(b)))
        .slice(0, limit);

      if (segNames.length === 0) {
        toast.error('AI 规划细分失败，请重试');
        return;
      }

      toast.info(`已规划 ${segNames.length} 个细分方向，开始打标...`);

      // ── 第二步：批量打标（并发 + 自动重试）──────────────────
      // 改造前：20 批串行 ≈ 3 分钟；改造后：4 路并发 ≈ 45 秒
      const bs = 30;
      const CONCURRENCY = 4;          // 并发数
      const MAX_RETRY = 1;            // 单批失败重试次数

      const batches: Keyword[][] = [];
      for (let i = 0; i < keywords.length; i += bs) batches.push(keywords.slice(i, i+bs));
      const tot = batches.length;
      setProg({ c: 0, t: tot });

      const buildPrompt = (batch: Keyword[]) => `你是资深亚马逊选品研究专家。请对以下关键词归类。

【可选细分方向 - 必须从中选一个，不能新增、不能改写】
${segNames.map((s,i)=>`${i+1}. ${s}`).join('  ')}

【词类标签 - 可选 1-3 个】
${TAGS.join('、')}

【规则】
- segment 字段必须严格等于上述列表中的一个原文
- 实在难以归类的关键词，segment 选最相近的一个（不要新建"其他"）
- keyword 字段必须原样回写（包括大小写、空格），便于回填

关键词列表：
${batch.map((k,n) => `${n+1}. ${k.keyword}（${k.translation}）`).join('\n')}

返回 JSON 数组：[{"keyword":"原词","segment":"细分名","tags":["词类标签"]}]`;

      // 单批处理：失败自动重试 MAX_RETRY 次
      const processBatch = async (batch: Keyword[]): Promise<{ok:boolean}> => {
        for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
          if (abort.current?.signal.aborted) return { ok: false };
          try {
            const r = await generateText(buildPrompt(batch), cfg, { jsonMode: true });
            const m = r.match(/\[.*\]/s);
            const rs = JSON.parse(m ? m[0] : r);
            if (!Array.isArray(rs)) throw new Error('非数组');
            setKeywords(prev => {
              const next = [...prev];
              rs.forEach((r: any) => {
                const idx = next.findIndex(k => k.keyword === r.keyword);
                if (idx !== -1) next[idx] = { ...next[idx],
                  aiTags: Array.isArray(r.tags) ? r.tags.filter((t:string) => TAGS.includes(t)) : next[idx].aiTags,
                  wordTag: r.segment && segNames.includes(r.segment) ? r.segment : (segNames[0] || next[idx].wordTag) };
              });
              return next;
            });
            return { ok: true };
          } catch (e) {
            console.error(`[打标] 第${attempt+1}次失败:`, e);
            if (attempt < MAX_RETRY) await new Promise(r => setTimeout(r, 800));
          }
        }
        return { ok: false };
      };

      // 任务池：CONCURRENCY 个 worker 并行从队列里取批次执行
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
      if (failed > 0) toast.warning(`AI 分析完成（${failed}/${tot} 批失败，可重试）`);
      else toast.success(`AI 分析完成！共 ${segNames.length} 个细分方向`);
      setTab('qd');
    } catch(e) { toast.error(`出错: ${e instanceof Error ? e.message : ''}`); }
    finally { setIsAI(false); setProg({ c:0, t:0 }); }
  };
  const stop = () => { abort.current?.abort(); setIsAI(false); toast.info('已取消'); };

  const genAI = async () => {
    const cfg = loadAiSettings();
    if (!cfg?.apiKey) { toast.error('请先配置 API Key'); return; }
    setGenIns(true);
    try {
      const ss = calcSegs(keywords);
      const top = [...keywords].sort((a,b) => b.weeklySearchVolume-a.weeklySearchVolume).slice(0,30);
      const p = `你是亚马逊品类专家。基于数据给洞察。\n细分：\n${ss.map(s => `- ${s.segment}：量${s.totalVolume.toLocaleString()}，CPC$${s.avgCpc.toFixed(2)}，词${s.count}，${s.quadrant}`).join('\n')}\nTop30：${top.map(k => `${k.keyword}(${k.translation},${k.weeklySearchVolume})`).join('，')}\n返回JSON：{"summary":"100字市场判断","topOpportunities":[{"segment":"名","reason":"理由50字"},{"segment":"名","reason":"理由50字"}],"whitespace":"白空间描述","userPainPoints":"用户核心痛点"}`;
      const r = await generateText(p, cfg, { jsonMode: true });
      const m = r.match(/\{.*\}/s);
      setIns(JSON.parse(m ? m[0] : r)); setTab('ai');
    } catch(e) { toast.error(`失败: ${e instanceof Error ? e.message : ''}`); }
    finally { setGenIns(false); }
  };

  const clear     = () => { setKeywords([]); setQ(''); setSeg(null); setIns(null); setTab('ov'); };
  const startEdit = (kw: Keyword) => { setEid(kw.id); setEtags(kw.aiTags); };
  const saveEdit  = (id: string) => { setKeywords(p => p.map(k => k.id===id ? {...k, aiTags:etags} : k)); setEid(null); };
  const togTag    = (t: string) => setEtags(p => p.includes(t) ? p.filter(x => x!==t) : [...p, t]);
  const onExport  = () => { exportKeywordsToExcel(keywords); toast.success('导出成功'); };

  // ── 细分管理：合并 / 改名 / 删除 ─────────────────────────────
  const mergeSegments = (sources: string[], target: string) => {
    if (!sources.length || !target.trim()) return;
    const tgt = target.trim();
    const set = new Set(sources);
    setKeywords(p => p.map(k => set.has((k.wordTag||'').trim()) ? { ...k, wordTag: tgt } : k));
    if (seg && set.has(seg)) setSeg(tgt);
    toast.success(`已合并 ${sources.length} 个细分 → ${tgt}`);
  };
  const renameSegment = (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName.trim()) return;
    const nn = newName.trim();
    setKeywords(p => p.map(k => (k.wordTag||'').trim()===oldName ? { ...k, wordTag: nn } : k));
    if (seg === oldName) setSeg(nn);
    toast.success(`已重命名：${oldName} → ${nn}`);
  };
  const deleteSegment = (name: string) => {
    setKeywords(p => p.map(k => (k.wordTag||'').trim()===name ? { ...k, wordTag: '' } : k));
    if (seg === name) setSeg(null);
    toast.success(`已清空细分「${name}」的归类`);
  };

  return (
    <KwView
      keywords={keywords} hasSeg={hasSeg} segs={segs} scat={scat}
      tStat={tStat} filt={filt} totVol={totVol}
      isAI={isAI} prog={prog} tab={tab} setTab={setTab}
      seg={seg} setSeg={setSeg} ins={ins} genIns={genIns}
      showT={showT} setShowT={setShowT}
      q={q} setQ={setQ} cat={cat} setCat={setCat}
      eid={eid} etags={etags}
      maxSegs={maxSegs} setMaxSegs={setMaxSegs}
      quadrantRule={quadrantRule} setQuadrantRule={setQuadrantRule}
      onUpload={upload} onRunAI={runAI} onStop={stop}
      onGenAI={genAI} onClear={clear} onExport={onExport}
      onStartEdit={startEdit} onSaveEdit={saveEdit}
      onCancelEdit={() => setEid(null)} onTogTag={togTag}
      onMergeSegments={mergeSegments}
      onRenameSegment={renameSegment}
      onDeleteSegment={deleteSegment}
    />
  );
}); 