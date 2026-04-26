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
}
export interface AiInsight {
  summary:string;
  topOpportunities:{segment:string;reason:string}[];
  whitespace:string;
  userPainPoints:string;
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
  const mv = vs[Math.floor(vs.length/2)];
  const mc = cs[Math.floor(cs.length/2)];
  const out: SegStat[] = [];
  map.forEach((ks, seg) => {
    const tv = ks.reduce((s,k) => s+k.weeklySearchVolume, 0);
    const ac = ks.reduce((s,k) => s+k.cpcBid, 0) / ks.length;
    const acvr = ks.reduce((s,k) => s+k.conversionRate, 0) / ks.length;
    const ad = ks.reduce((s,k) => s+k.difficulty, 0) / ks.length;
    const tk = [...ks].sort((a,b) => b.weeklySearchVolume-a.weeklySearchVolume).slice(0,5).map(k => k.keyword);
    const hv = tv >= mv, hc = ac >= mc;
    out.push({ segment:seg, count:ks.length, totalVolume:tv, avgCpc:ac, avgCvr:acvr, avgDifficulty:ad, topKeywords:tk,
      quadrant: hv&&!hc?'黄金机会': hv&&hc?'红海市场': !hv&&!hc?'长尾蓝海': '陷阱区' });
  });
  return out.sort((a,b) => b.totalVolume - a.totalVolume);
}

export function exportKeywordsToExcel(keywords: Keyword[]) {
  const rows = keywords.map(k => ({
    '关键词': k.keyword,
    '翻译': k.translation,
    '细分方向': k.wordTag || '',
    '周搜索量': k.weeklySearchVolume,
    'CPC建议竞价': k.cpcBid,
    '点击转化率': k.conversionRate,
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
      // 第一步：全量发送关键词列表，让AI统一规划细分（控制上限）
      const limit = maxSegs;
      const allKwList = keywords.map((k, n) => `${n+1}. ${k.keyword}（${k.translation}，周搜索量:${k.weeklySearchVolume}）`).join('\n');
      setProg({ c: 1, t: 2 });
      const planPrompt = `你是资深亚马逊品类研究专家。
我有${keywords.length}个关键词，请你先规划出${limit}个以内（尽量少而精，6-${limit}个最佳）的细分方向名称。
要求：
1. 名称简洁（2-8个中文字），有商业意义
2. 相似方向必须合并，不能过细
3. 基于产品功能/使用场景/目标人群/形态材质来区分
4. 一定要覆盖绝大多数关键词
5. 细分数量控制在${limit}个以内

关键词列表（前100个）：
${keywords.slice(0, 100).map((k, n) => `${n+1}. ${k.keyword}（${k.translation}，搜索量:${k.weeklySearchVolume}）`).join('\n')}

返回JSON：{"segments":["细分名1","细分名2",...]}`;

      const planRes = await generateText(planPrompt, cfg, { jsonMode: true });
      const planMatch = planRes.match(/\{.*\}/s);
      let segNames: string[] = [];
      try {
        const planJson = JSON.parse(planMatch ? planMatch[0] : planRes);
        segNames = Array.isArray(planJson.segments) ? planJson.segments.slice(0, limit) : [];
      } catch { segNames = []; }

      if (segNames.length === 0) {
        toast.error('AI 规划细分失败，请重试');
        return;
      }

      toast.info(`已规划 ${segNames.length} 个细分方向，开始打标...`);

      // 第二步：批量打标，每批30个，告知AI已规划的细分名
      const bs = 30;
      const tot = Math.ceil(keywords.length / bs);
      for (let i = 0; i < keywords.length; i += bs) {
        if (abort.current.signal.aborted) break;
        setProg({ c: Math.floor(i/bs)+1, t: tot });
        const batch = keywords.slice(i, i+bs);
        const p = `你是资深亚马逊品类研究专家。请对以下关键词进行分类打标。

已规划细分方向（必须从这些中选一个，不能新增）：${segNames.map((s,i)=>`${i+1}.${s}`).join('、')}

词类标签（可选1-3个）：[${TAGS.join('、')}]

关键词列表：
${batch.map((k,n) => `${n+1}. ${k.keyword}（${k.translation}）`).join('\n')}

返回JSON数组：[{"keyword":"x","segment":"细分名","tags":["标签"]}]`;
        try {
          const r = await generateText(p, cfg, { jsonMode: true });
          const m = r.match(/\[.*\]/s);
          const rs = JSON.parse(m ? m[0] : r);
          if (Array.isArray(rs)) setKeywords(prev => {
            const next = [...prev];
            rs.forEach((r: any) => {
              const idx = next.findIndex(k => k.keyword === r.keyword);
              if (idx !== -1) next[idx] = { ...next[idx],
                aiTags: Array.isArray(r.tags) ? r.tags.filter((t:string) => TAGS.includes(t)) : next[idx].aiTags,
                wordTag: r.segment && segNames.includes(r.segment) ? r.segment : (segNames[0] || next[idx].wordTag) };
            });
            return next;
          });
          if (i+bs < keywords.length) await new Promise(r => setTimeout(r, 200));
        } catch(e) { console.error(e); }
      }
      toast.success(`AI 分析完成！共 ${segNames.length} 个细分方向`); setTab('qd');
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
    />
  );
}); 