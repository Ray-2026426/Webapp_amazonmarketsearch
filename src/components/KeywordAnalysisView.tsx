import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { Upload, FileSpreadsheet, Brain, Trash2, Edit2, Check, X, Filter, ExternalLink, Zap, Search, Target, Lightbulb, BarChart2, Sparkles, TrendingUp, Tag, Download, HelpCircle, Settings2, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-react';
import { Keyword } from '../utils/parser';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, BarChart, Bar } from 'recharts';
import { SegStat, AiInsight, QI, SC, TAGS, QuadrantRule, DEFAULT_QUADRANT_RULE } from './KeywordAnalysis';

const TL=[{id:'ss',name:'卖家精灵',desc:'ABA 关键词反查',url:'https://www.sellersprite.com/v3/aba-research',bg:'bg-violet-50',bd:'border-violet-100',ac:'text-violet-600',ib:'bg-violet-100',tag:'ABA 反查'},{id:'xy',name:'西柚找词',desc:'搜索词浏览器',url:'https://www.xiyouzhaoci.com/searchTerm_explorer?country=US',bg:'bg-orange-50',bd:'border-orange-100',ac:'text-orange-500',ib:'bg-orange-100',tag:'搜索词挖掘'}];

const TB=()=>(<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{TL.map(t=>(<a key={t.id} href={t.url} target="_blank" rel="noopener noreferrer" className={`group flex items-center gap-4 p-4 rounded-2xl border ${t.bd} ${t.bg} hover:shadow-md transition-all hover:-translate-y-0.5 no-underline`}><div className={`w-11 h-11 rounded-xl ${t.ib} flex items-center justify-center shrink-0`}><span className={`text-lg font-black ${t.ac}`}>{t.name[0]}</span></div><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="font-bold text-[#1d1d1f] text-[15px]">{t.name}</span><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${t.bg} ${t.ac} border ${t.bd}`}>{t.tag}</span></div><p className="text-xs text-[#86868b] mt-0.5 truncate">{t.desc}</p></div><ExternalLink className={`w-4 h-4 ${t.ac} opacity-50 group-hover:opacity-100 shrink-0`}/></a>))}</div>);

const QTip=({active,payload}:any)=>{
  if(!active||!payload?.length)return null;
  const d=payload[0].payload as SegStat&{color:string};const qi=QI[d.quadrant];
  return(<div className="bg-white border border-black/10 rounded-2xl shadow-xl p-4 max-w-[240px]"><div className="font-bold text-[#1d1d1f] text-sm mb-2">{d.segment}</div><div className="space-y-1 text-xs text-[#86868b]">{[['周搜索量',d.totalVolume.toLocaleString()],['平均CPC',`$${d.avgCpc.toFixed(2)}`],['词数',d.count],['均CVR',`${(d.avgCvr*100).toFixed(1)}%`],['平均难度',d.avgDifficulty.toFixed(1)]].map(([l,v])=>(<div key={String(l)} className="flex justify-between gap-4"><span>{l}</span><span className="font-semibold text-[#1d1d1f]">{v}</span></div>))}</div>{qi&&<div className="mt-2 pt-2 border-t border-black/5 text-[11px] font-bold" style={{color:qi.color}}>{qi.label} — {qi.desc}</div>}{d.topKeywords?.length>0&&<div className="mt-2 pt-2 border-t border-black/5"><div className="text-[10px] text-[#86868b] mb-1">代表词</div><div className="flex flex-wrap gap-1">{d.topKeywords.slice(0,3).map((kw:string)=>(<span key={kw} className="text-[10px] bg-[#f5f5f7] px-1.5 py-0.5 rounded">{kw}</span>))}</div></div>}</div>);
};

// 四象限说明弹窗
function QuadrantInfoModal({ rule, onClose, onSave }: { rule: QuadrantRule; onClose: () => void; onSave: (r: QuadrantRule) => void }) {
  const [draft, setDraft] = useState<QuadrantRule>(rule);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-lg rounded-[24px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-2"><Target className="w-5 h-5 text-rose-500"/><h3 className="font-semibold text-[#1d1d1f]">四象限判断标准</h3></div>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 rounded-full"><X className="w-4 h-4 text-[#86868b]"/></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-[#86868b] leading-relaxed">四象限以<strong>周搜索量中位数</strong>为需求分界、<strong>平均CPC中位数</strong>为竞争分界，将细分方向分为四类。你可以在下方自定义各维度的描述说明。</p>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(QI).map(([k,q])=>(
              <div key={k} className={`${q.bg} border border-black/5 rounded-2xl p-3`}>
                <div className="font-bold text-sm mb-1" style={{color:q.color}}>{q.label}</div>
                <div className="text-xs text-[#86868b]">{q.desc}</div>
              </div>
            ))}
          </div>
          <div className="space-y-3 pt-2">
            <div className="text-xs font-bold text-[#1d1d1f] uppercase tracking-wider">自定义维度说明</div>
            {([
              ['highVolLabel','高需求定义',draft.highVolLabel],
              ['lowVolLabel','低需求定义',draft.lowVolLabel],
              ['highCpcLabel','高竞争定义',draft.highCpcLabel],
              ['lowCpcLabel','低竞争定义',draft.lowCpcLabel],
            ] as [keyof QuadrantRule, string, string][]).map(([field,label,val])=>(
              <div key={field}>
                <div className="text-xs text-[#86868b] mb-1">{label}</div>
                <input value={val} onChange={e=>setDraft(d=>({...d,[field]:e.target.value}))} className="w-full px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"/>
              </div>
            ))}
          </div>
        </div>
        <div className="p-5 border-t border-black/5 flex justify-end gap-3">
          <button onClick={()=>{ setDraft(DEFAULT_QUADRANT_RULE); }} className="px-4 py-2 text-sm text-[#86868b] hover:text-[#1d1d1f]">恢复默认</button>
          <button onClick={()=>{ onSave(draft); onClose(); }} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700">保存</button>
        </div>
      </div>
    </div>
  );
}

// 细分数量设置弹窗
function SegLimitModal({ maxSegs, onClose, onSave }: { maxSegs: number; onClose: () => void; onSave: (n: number) => void }) {
  const [val, setVal] = useState(maxSegs);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-2"><Settings2 className="w-5 h-5 text-indigo-500"/><h3 className="font-semibold text-[#1d1d1f]">细分数量上限</h3></div>
          <button onClick={onClose} className="p-1.5 hover:bg-black/5 rounded-full"><X className="w-4 h-4 text-[#86868b]"/></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-[#86868b] leading-relaxed">控制 AI 生成的细分方向数量上限。数值越小，聚合度越高；越大则越细化。推荐 8-15 个。</p>
          <div className="flex items-center gap-4">
            <input type="range" min={4} max={20} value={val} onChange={e=>setVal(Number(e.target.value))} className="flex-1 accent-indigo-600"/>
            <span className="text-2xl font-bold text-indigo-600 w-10 text-center">{val}</span>
          </div>
          <div className="flex justify-between text-xs text-[#86868b]"><span>4（高聚合）</span><span>20（细化）</span></div>
        </div>
        <div className="p-5 border-t border-black/5 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#86868b] hover:text-[#1d1d1f]">取消</button>
          <button onClick={()=>{ onSave(val); onClose(); }} className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700">确定</button>
        </div>
      </div>
    </div>
  );
}

export interface KwViewProps{
  keywords:Keyword[]; hasSeg:boolean; segs:SegStat[];
  scat:(SegStat&{x:number;y:number;z:number;color:string})[];
  tStat:{name:string;count:number;vol:number}[];
  filt:Keyword[]; totVol:number;
  isAI:boolean; prog:{c:number;t:number};
  tab:'ov'|'qd'|'dd'|'ai'; setTab:(t:'ov'|'qd'|'dd'|'ai')=>void;
  seg:string|null; setSeg:(s:string|null)=>void;
  ins:AiInsight|null; genIns:boolean;
  showT:boolean; setShowT:(v:boolean)=>void;
  q:string; setQ:(v:string)=>void;
  cat:string; setCat:(v:string)=>void;
  eid:string|null; etags:string[];
  maxSegs:number; setMaxSegs:(n:number)=>void;
  quadrantRule:QuadrantRule; setQuadrantRule:(r:QuadrantRule)=>void;
  onUpload:(e:React.ChangeEvent<HTMLInputElement>)=>void;
  onRunAI:()=>void; onStop:()=>void;
  onGenAI:()=>void; onClear:()=>void; onExport:()=>void;
  onStartEdit:(kw:Keyword)=>void;
  onSaveEdit:(id:string)=>void;
  onCancelEdit:()=>void;
  onTogTag:(tag:string)=>void;
}

export function KwView(p:KwViewProps){
  const [showQInfo, setShowQInfo] = useState(false);
  const [showSegLimit, setShowSegLimit] = useState(false);
  const{keywords,hasSeg,segs,scat,tStat,filt,totVol,isAI,prog,tab,setTab,seg,setSeg,ins,genIns,showT,setShowT,q,setQ,cat,setCat,eid,etags,maxSegs,setMaxSegs,quadrantRule,setQuadrantRule,onUpload,onRunAI,onStop,onGenAI,onClear,onExport,onStartEdit,onSaveEdit,onCancelEdit,onTogTag}=p;
  return(
    <div className="space-y-6">
      {showQInfo && <QuadrantInfoModal rule={quadrantRule} onClose={()=>setShowQInfo(false)} onSave={setQuadrantRule}/>}
      {showSegLimit && <SegLimitModal maxSegs={maxSegs} onClose={()=>setShowSegLimit(false)} onSave={setMaxSegs}/>}

      <div><div className="flex items-center gap-2 mb-3"><Zap className="w-4 h-4 text-indigo-500"/><span className="text-sm font-semibold text-[#1d1d1f]">选词工具快捷入口</span><span className="text-xs text-[#86868b]">— 新标签页，浏览器可记住密码</span></div><TB/></div>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
          <div className="flex items-center justify-between">
            <div><CardTitle className="text-lg font-semibold flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-indigo-600"/>关键词数据</CardTitle><CardDescription>上传西柚找词/卖家精灵导出的关键词表</CardDescription></div>
            {keywords.length>0&&(
              <div className="flex items-center gap-2">
                <button onClick={()=>setShowSegLimit(true)} title={`细分上限: ${maxSegs}`} className="flex items-center gap-1.5 px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-xs font-medium text-[#86868b] hover:text-[#1d1d1f] transition-colors">
                  <Settings2 className="w-3.5 h-3.5"/>细分上限: {maxSegs}
                </button>
                <button onClick={onExport} className="flex items-center gap-1.5 px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-xs font-medium text-[#86868b] hover:text-emerald-600 transition-colors"><Download className="w-3.5 h-3.5"/>导出 Excel</button>
                <button onClick={isAI?onStop:onRunAI} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${isAI?'bg-rose-50 text-rose-600':'bg-indigo-600 text-white hover:bg-indigo-700'}`}><Brain className="w-4 h-4"/>{isAI?`取消(${prog.c}/${prog.t})`:'AI 智能分析'}</button>
                <button onClick={onClear} className="flex items-center gap-2 bg-rose-50 text-rose-600 px-3 py-2 rounded-xl text-sm font-medium"><Trash2 className="w-4 h-4"/></button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {keywords.length===0?(
            <div className="border-2 border-dashed border-black/10 rounded-[24px] p-12 flex flex-col items-center text-center hover:border-indigo-500 hover:bg-indigo-50/30 transition-all cursor-pointer relative group">
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"/>
              <div className="w-16 h-16 bg-[#f5f5f7] rounded-full flex items-center justify-center mb-4 group-hover:bg-indigo-100"><Upload className="w-8 h-8 text-[#86868b] group-hover:text-indigo-600"/></div>
              <h3 className="text-lg font-semibold text-[#1d1d1f]">点击或拖拽上传关键词表</h3>
              <p className="text-sm text-[#86868b] mt-2 max-w-md">支持 Excel/CSV，含关键词、搜索量、CPC、转化率字段</p>
            </div>
          ):(<div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[{l:'总词数',v:keywords.length.toLocaleString(),c:'text-[#1d1d1f]'},{l:'总周搜索量',v:totVol.toLocaleString(),c:'text-emerald-600'},{l:'识别细分',v:`${segs.length} 个`,c:'text-indigo-600'},{l:'已打标',v:`${keywords.filter(k=>k.aiTags.length>0).length} 个`,c:'text-violet-600'}].map(m=>(<div key={m.l} className="bg-[#f5f5f7] p-4 rounded-2xl border border-black/5"><div className="text-xs text-[#86868b] uppercase tracking-wider mb-1">{m.l}</div><div className={`text-2xl font-bold ${m.c}`}>{m.v}</div></div>))}</div>)}
        </CardContent>
      </Card>

      {keywords.length>0&&<>
        <div className="flex gap-1 bg-[#f5f5f7] p-1 rounded-2xl w-fit">
          {([{id:'ov'as const,l:'需求地图',I:BarChart2,s:true},{id:'qd'as const,l:'机会四象限',I:Target,s:hasSeg},{id:'dd'as const,l:'细分深挖',I:TrendingUp,s:hasSeg},{id:'ai'as const,l:'AI 市场洞察',I:Lightbulb,s:true}]).filter(t=>t.s).map(({id,l,I})=>(
            <button key={id} onClick={()=>setTab(id)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab===id?'bg-white text-[#1d1d1f] shadow-sm':'text-[#86868b] hover:text-[#1d1d1f]'}`}><I className="w-4 h-4"/>{l}</button>
          ))}
        </div>

        {tab==='ov'&&<OvTab hasSeg={hasSeg} segs={segs} tStat={tStat}/>}
        {tab==='qd'&&hasSeg&&<QdTab scat={scat} segs={segs} setSeg={setSeg} setTab={setTab} onShowQInfo={()=>setShowQInfo(true)}/>}
        {tab==='dd'&&hasSeg&&<DdTab segs={segs} seg={seg} setSeg={setSeg} keywords={keywords}/>}
        {tab==='ai'&&<AiTab ins={ins} hasSeg={hasSeg} genIns={genIns} onGenAI={onGenAI} setSeg={setSeg} setTab={setTab}/>}

        <div><button type="button" onClick={() => setShowT(!showT)} className="flex items-center gap-2 text-sm text-[#86868b] hover:text-[#1d1d1f] font-medium"><Filter className="w-4 h-4"/>{showT?'收起':'展开'}原始关键词表<span className="text-xs bg-[#f5f5f7] px-2 py-0.5 rounded-full border border-black/5">{keywords.length} 个词</span></button></div>
        {showT&&<RawTable filt={filt} eid={eid} etags={etags} q={q} setQ={setQ} cat={cat} setCat={setCat} onStartEdit={onStartEdit} onSaveEdit={onSaveEdit} onCancelEdit={onCancelEdit} onTogTag={onTogTag}/>}
      </>}
    </div>
  );
}

// ─── OvTab ───────────────────────────────────────────────────────────────────
function OvTab({hasSeg,segs,tStat}:{hasSeg:boolean;segs:SegStat[];tStat:{name:string;count:number;vol:number}[]}){
  const barH = Math.max(280, segs.length * 38);
  const maxLabelLen = segs.reduce((m,s)=>Math.max(m,s.segment.length),0);
  const yAxisW = Math.min(160, Math.max(80, maxLabelLen * 8));
  return(<div className="space-y-6">
    {!hasSeg&&<div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center gap-3"><Sparkles className="w-5 h-5 text-indigo-500 shrink-0"/><p className="text-sm text-indigo-700">点击「AI 智能分析」，AI 自动识别细分方向并打标，解锁机会四象限和细分深挖。</p></div>}
    {hasSeg&&<Card className="border-none shadow-sm">
      <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><BarChart2 className="w-4 h-4 text-indigo-600"/>各细分方向需求强度<span className="text-xs font-normal text-[#86868b] ml-1">（周搜索量）</span></CardTitle></CardHeader>
      <CardContent style={{height: barH}}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={segs} layout="vertical" margin={{left:8,right:70,top:4,bottom:4}}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb"/>
            <XAxis type="number" hide/>
            <YAxis dataKey="segment" type="category" axisLine={false} tickLine={false} fontSize={11} width={yAxisW} tick={{fill:'#374151'}}/>
            <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 15px -3px rgb(0 0 0/0.1)'}} formatter={(v:number)=>[v.toLocaleString(),'周搜索量']}/>
            <Bar dataKey="totalVolume" radius={[0,6,6,0]} barSize={22} label={{position:'right',fontSize:10,formatter:(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)}}>
              {segs.map((_,i)=><Cell key={i} fill={SC[i%SC.length]}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>}
    {tStat.length>0&&<Card className="border-none shadow-sm">
      <CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-violet-600"/>用户意图词类分布<span className="text-xs font-normal text-[#86868b] ml-1">（词数）</span></CardTitle></CardHeader>
      <CardContent className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={tStat} layout="vertical" margin={{left:8,right:40,top:4,bottom:4}}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb"/>
            <XAxis type="number" hide/>
            <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={11} width={60}/>
            <Tooltip contentStyle={{borderRadius:'12px',border:'none',boxShadow:'0 10px 15px -3px rgb(0 0 0/0.1)'}}/>
            <Bar dataKey="count" name="词数" radius={[0,6,6,0]} barSize={16} label={{position:'right',fontSize:10}}>
              {tStat.map((_,i)=><Cell key={i} fill={SC[i%SC.length]}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>}
  </div>);
}

// ─── QdTab ───────────────────────────────────────────────────────────────────
function QdTab({scat,segs,setSeg,setTab,onShowQInfo}:{scat:(SegStat&{x:number;y:number;z:number;color:string})[];segs:SegStat[];setSeg:(s:string|null)=>void;setTab:(t:'ov'|'qd'|'dd'|'ai')=>void;onShowQInfo:()=>void}){
  return(<div className="space-y-6">
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Object.entries(QI).map(([k,q])=>(
        <div key={k} className={`${q.bg} border border-black/5 rounded-2xl p-3`}>
          <div className="font-bold text-sm mb-0.5" style={{color:q.color}}>{q.label}</div>
          <div className="text-xs text-[#86868b]">{q.desc}</div>
        </div>
      ))}
    </div>
    <Card className="border-none shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Target className="w-4 h-4 text-rose-500"/>机会四象限
          <span className="text-xs font-normal text-[#86868b] ml-1">X轴=周搜索量 · Y轴=均CPC · 点击进入细分深挖</span>
          <button onClick={onShowQInfo} className="ml-auto flex items-center gap-1 text-xs text-indigo-500 hover:text-indigo-700 font-medium"><HelpCircle className="w-3.5 h-3.5"/>判断标准</button>
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{top:20,right:30,bottom:20,left:10}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb"/>
            <XAxis type="number" dataKey="x" tickFormatter={(v:number)=>v>=1000?`${(v/1000).toFixed(0)}k`:String(v)} label={{value:'需求（周搜索量）',position:'insideBottom',offset:-10,fontSize:11,fill:'#86868b'}}/>
            <YAxis type="number" dataKey="y" tickFormatter={(v:number)=>`$${v.toFixed(2)}`} label={{value:'竞争（均CPC）',angle:-90,position:'insideLeft',offset:10,fontSize:11,fill:'#86868b'}}/>
            <Tooltip content={<QTip/>}/>
            <Scatter data={scat} onClick={(d:any)=>{setSeg(d.segment);setTab('dd');}} cursor="pointer">
              {scat.map((d,i)=><Cell key={i} fill={d.color} fillOpacity={0.85}/>)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        <div className="overflow-x-auto pb-1">
          <div className="flex gap-2 mt-3 w-max">
            {scat.map((d,i)=>(
              <button key={i} onClick={()=>{setSeg(d.segment);setTab('dd');}} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-black/5 hover:shadow-sm whitespace-nowrap" style={{background:`${d.color}18`,color:d.color}}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{background:d.color}}/>
                <span className="max-w-[120px] truncate">{d.segment}</span>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  </div>);
}

// ─── DdTab ───────────────────────────────────────────────────────────────────
function DdTab({segs,seg,setSeg,keywords}:{segs:SegStat[];seg:string|null;setSeg:(s:string|null)=>void;keywords:Keyword[]}){
  const [showAll, setShowAll] = useState(false);
  const [sortCol, setSortCol] = useState<'weeklySearchVolume'|'cpcBid'|'conversionRate'|'difficulty'>('weeklySearchVolume');
  const [sortAsc, setSortAsc] = useState(false);
  const stat=segs.find(s=>s.segment===seg);
  const words=useMemo(()=>keywords.filter(k=>k.wordTag?.trim()===seg).sort((a,b)=>sortAsc?a[sortCol]-b[sortCol]:b[sortCol]-a[sortCol]),[keywords,seg,sortCol,sortAsc]);
  const shown=showAll?words:words.slice(0,50);

  const toggleSort=(col:typeof sortCol)=>{
    if(sortCol===col) setSortAsc(v=>!v);
    else { setSortCol(col); setSortAsc(false); }
  };

  return(<div className="space-y-6">
    <div className="flex flex-wrap gap-2">
      {segs.map((s,i)=>(
        <button key={s.segment} onClick={()=>setSeg(s.segment)}
          title={s.segment}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${seg===s.segment?'text-white border-transparent shadow-md':'bg-white border-black/10 text-[#86868b] hover:border-indigo-300'}`}
          style={seg===s.segment?{background:SC[i%SC.length]}:{}}>
          <span className="max-w-[120px] truncate">{s.segment}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${seg===s.segment?'bg-white/20 text-white':'bg-[#f5f5f7] text-[#86868b]'}`}>{QI[s.quadrant]?.label??s.quadrant}</span>
        </button>
      ))}
    </div>
    {!seg&&<div className="bg-[#f5f5f7] rounded-2xl p-8 text-center text-[#86868b] text-sm">请在上方选择一个细分方向查看详情</div>}
    {seg&&stat&&<>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[{l:'周搜索量',v:stat.totalVolume.toLocaleString(),c:'text-indigo-600'},{l:'平均CPC',v:`$${stat.avgCpc.toFixed(2)}`,c:'text-rose-500'},{l:'平均转化率',v:`${(stat.avgCvr*100).toFixed(1)}%`,c:'text-emerald-600'},{l:'关键词数',v:String(stat.count),c:'text-amber-500'}].map(m=>(
          <div key={m.l} className="bg-white border border-black/5 rounded-2xl p-4 shadow-sm"><div className="text-xs text-[#86868b] uppercase tracking-wider mb-1">{m.l}</div><div className={`text-2xl font-bold ${m.c}`}>{m.v}</div></div>
        ))}
      </div>
      <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl border border-black/5 ${QI[stat.quadrant]?.bg??'bg-[#f5f5f7]'} w-fit`}>
        <span className="text-sm font-bold" style={{color:QI[stat.quadrant]?.color??'#86868b'}}>{QI[stat.quadrant]?.label??stat.quadrant}</span>
        <span className="text-xs text-[#86868b] ml-1">{QI[stat.quadrant]?.desc}</span>
      </div>
      {stat.topKeywords.length>0&&(
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-[#86868b] font-medium">代表词：</span>
          {stat.topKeywords.map(kw=>(<span key={kw} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full text-xs font-medium border border-indigo-100">{kw}</span>))}
        </div>
      )}
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">「{stat.segment}」关键词列表</CardTitle>
            <span className="text-xs text-[#86868b]">{words.length} 个词</span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] border-b border-black/5">
                <tr>
                  <th className="px-5 py-3 font-medium">关键词 / 翻译</th>
                  <th className="px-5 py-3 font-medium text-right cursor-pointer hover:text-indigo-600 select-none" onClick={()=>toggleSort('weeklySearchVolume')}>
                    <span className="flex items-center justify-end gap-1">周搜索量<ArrowUpDown className="w-3 h-3"/></span>
                  </th>
                  <th className="px-5 py-3 font-medium text-right cursor-pointer hover:text-indigo-600 select-none" onClick={()=>toggleSort('cpcBid')}>
                    <span className="flex items-center justify-end gap-1">CPC<ArrowUpDown className="w-3 h-3"/></span>
                  </th>
                  <th className="px-5 py-3 font-medium text-right cursor-pointer hover:text-indigo-600 select-none" onClick={()=>toggleSort('conversionRate')}>
                    <span className="flex items-center justify-end gap-1">转化率<ArrowUpDown className="w-3 h-3"/></span>
                  </th>
                  <th className="px-5 py-3 font-medium text-right cursor-pointer hover:text-indigo-600 select-none" onClick={()=>toggleSort('difficulty')}>
                    <span className="flex items-center justify-end gap-1">难度<ArrowUpDown className="w-3 h-3"/></span>
                  </th>
                  <th className="px-5 py-3 font-medium text-right">自然滚动率</th>
                  <th className="px-5 py-3 font-medium text-right">Top3点击</th>
                  <th className="px-5 py-3 font-medium">词类标签</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {shown.map(kw=>(
                  <tr key={kw.id} className="hover:bg-[#f5f5f7]/50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-[#1d1d1f]">{kw.keyword}</div>
                      <div className="text-xs text-[#86868b]">{kw.translation}</div>
                      {kw.matchType&&<div className="text-[10px] text-[#86868b] mt-0.5">{kw.matchType} · {kw.relevanceTier}</div>}
                    </td>
                    <td className="px-5 py-3 text-right font-mono">{kw.weeklySearchVolume.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right font-mono">${kw.cpcBid.toFixed(2)}
                      {kw.cpcBidRange&&<div className="text-[10px] text-[#86868b]">{kw.cpcBidRange}</div>}
                    </td>
                    <td className="px-5 py-3 text-right font-mono">{(kw.conversionRate*100).toFixed(2)}%</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        kw.difficulty>=70?'bg-rose-50 text-rose-600':kw.difficulty>=40?'bg-amber-50 text-amber-600':'bg-emerald-50 text-emerald-600'
                      }`}>{kw.difficulty.toFixed(0)}</span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-xs">{(kw.organicScrollRate*100).toFixed(1)}%</td>
                    <td className="px-5 py-3 text-right font-mono text-xs">{(kw.top3ClickShare*100).toFixed(1)}%</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {kw.aiTags.length>0?kw.aiTags.map(t=><span key={t} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-medium border border-indigo-100">{t}</span>):<span className="text-[#86868b] text-xs italic">未打标</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {words.length>50&&(
            <div className="p-4 text-center border-t border-black/5">
              <button onClick={()=>setShowAll(v=>!v)} className="flex items-center gap-2 mx-auto text-sm text-indigo-600 hover:text-indigo-700 font-medium">
                {showAll?<><ChevronUp className="w-4 h-4"/>收起</>:<><ChevronDown className="w-4 h-4"/>显示全部 {words.length} 个词</>}
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </>}
  </div>);
}

// ─── AiTab ───────────────────────────────────────────────────────────────────
function AiTab({ins,hasSeg,genIns,onGenAI,setSeg,setTab}:{ins:AiInsight|null;hasSeg:boolean;genIns:boolean;onGenAI:()=>void;setSeg:(s:string|null)=>void;setTab:(t:'ov'|'qd'|'dd'|'ai')=>void}){
  if(!ins)return(
    <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-100 rounded-[24px] p-10 flex flex-col items-center text-center gap-4">
      <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-md"><Lightbulb className="w-8 h-8 text-indigo-500"/></div>
      <div><h3 className="text-xl font-bold text-[#1d1d1f] mb-2">AI 市场洞察报告</h3><p className="text-sm text-[#86868b] max-w-md">{hasSeg?'AI 将综合分析所有细分方向，指出最值得进入的方向和潜在白空间。':'请先点击「AI 智能分析」完成细分识别，再生成洞察报告。'}</p></div>
      <button onClick={onGenAI} disabled={genIns||!hasSeg} className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold transition-all disabled:opacity-50 shadow-lg shadow-indigo-200"><Sparkles className={`w-4 h-4 ${genIns?'animate-spin':''}`}/>{genIns?'生成中...':'生成市场洞察'}</button>
    </div>
  );
  return(<div className="space-y-5">
    <Card className="border-none shadow-sm"><CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500"/>市场总体判断</CardTitle></CardHeader><CardContent><p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.summary}</p></CardContent></Card>
    <Card className="border-none shadow-sm"><CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Target className="w-4 h-4 text-emerald-500"/>最值得进入的细分方向</CardTitle></CardHeader><CardContent className="space-y-3">{ins.topOpportunities.map((op,i)=>(<div key={i} className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl"><div className="w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center shrink-0 text-sm font-bold">{i+1}</div><div className="flex-1"><div className="font-semibold text-[#1d1d1f] text-sm">{op.segment}</div><div className="text-xs text-[#86868b] mt-1">{op.reason}</div></div><button onClick={()=>{setSeg(op.segment);setTab('dd');}} className="shrink-0 text-xs text-emerald-600 hover:text-emerald-700 font-medium">查看详情 →</button></div>))}</CardContent></Card>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <Card className="border-none shadow-sm"><CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-blue-500"/>市场白空间</CardTitle></CardHeader><CardContent><p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.whitespace}</p></CardContent></Card>
      <Card className="border-none shadow-sm"><CardHeader><CardTitle className="text-base font-semibold flex items-center gap-2"><Tag className="w-4 h-4 text-violet-500"/>用户核心痛点</CardTitle></CardHeader><CardContent><p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.userPainPoints}</p></CardContent></Card>
    </div>
    <div className="flex justify-end"><button onClick={onGenAI} disabled={genIns} className="flex items-center gap-2 px-4 py-2 bg-[#f5f5f7] hover:bg-[#ebebeb] text-[#86868b] rounded-xl text-sm font-medium disabled:opacity-50"><Sparkles className="w-4 h-4"/>{genIns?'生成中...':'重新生成'}</button></div>
  </div>);
}

// ─── RawTable ─────────────────────────────────────────────────────────────────
function RawTable({filt,eid,etags,q,setQ,cat,setCat,onStartEdit,onSaveEdit,onCancelEdit,onTogTag}:{filt:Keyword[];eid:string|null;etags:string[];q:string;setQ:(v:string)=>void;cat:string;setCat:(v:string)=>void;onStartEdit:(kw:Keyword)=>void;onSaveEdit:(id:string)=>void;onCancelEdit:()=>void;onTogTag:(t:string)=>void}){
  return(
    <Card className="border-none shadow-sm overflow-hidden">
      <CardHeader className="bg-[#f5f5f7]/50 border-b border-black/5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]"/><input type="text" placeholder="搜索关键词或翻译..." value={q} onChange={e=>setQ(e.target.value)} className="pl-10 pr-4 py-2 bg-white border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 w-56"/></div>
            <div className="flex items-center gap-2"><Filter className="w-4 h-4 text-[#86868b]"/><select value={cat} onChange={e=>setCat(e.target.value)} className="bg-white border border-black/5 rounded-xl text-sm px-3 py-2 focus:outline-none"><option value="all">全部类别</option>{TAGS.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
          </div>
          <div className="text-xs text-[#86868b]">显示 {filt.length} 个关键词</div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] border-b border-black/5">
              <tr>
                <th className="px-6 py-4 font-medium">关键词/翻译</th>
                <th className="px-6 py-4 font-medium text-right">周搜索量</th>
                <th className="px-6 py-4 font-medium text-right">CPC</th>
                <th className="px-6 py-4 font-medium text-right">转化率</th>
                <th className="px-6 py-4 font-medium text-right">难度</th>
                <th className="px-6 py-4 font-medium">细分方向</th>
                <th className="px-6 py-4 font-medium">AI标签</th>
                <th className="px-6 py-4 font-medium text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {filt.map(kw=>(
                <tr key={kw.id} className="hover:bg-[#f5f5f7]/50">
                  <td className="px-6 py-4"><div className="font-medium text-[#1d1d1f]">{kw.keyword}</div><div className="text-xs text-[#86868b] mt-0.5">{kw.translation}</div></td>
                  <td className="px-6 py-4 text-right font-mono">{kw.weeklySearchVolume.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right font-mono">${kw.cpcBid.toFixed(2)}</td>
                  <td className="px-6 py-4 text-right font-mono">{(kw.conversionRate*100).toFixed(2)}%</td>
                  <td className="px-6 py-4 text-right"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${kw.difficulty>=70?'bg-rose-50 text-rose-600':kw.difficulty>=40?'bg-amber-50 text-amber-600':'bg-emerald-50 text-emerald-600'}`}>{kw.difficulty.toFixed(0)}</span></td>
                  <td className="px-6 py-4">{kw.wordTag?<span className="px-2 py-0.5 bg-[#f5f5f7] text-[#1d1d1f] rounded-full text-[10px] font-medium border border-black/5">{kw.wordTag}</span>:<span className="text-[#86868b] text-xs italic">未分类</span>}</td>
                  <td className="px-6 py-4">{eid===kw.id?(<div className="flex flex-wrap gap-1 max-w-[280px]">{TAGS.map(t=>(<button key={t} onClick={()=>onTogTag(t)} className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${etags.includes(t)?'bg-indigo-100 text-indigo-600 border border-indigo-200':'bg-white text-[#86868b] border border-black/5'}`}>{t}</button>))}</div>):(<div className="flex flex-wrap gap-1">{kw.aiTags.length>0?kw.aiTags.map(t=><span key={t} className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-medium border border-indigo-100">{t}</span>):<span className="text-[#86868b] text-xs italic">未打标</span>}</div>)}</td>
                  <td className="px-6 py-4 text-center">{eid===kw.id?(<div className="flex items-center justify-center gap-2"><button onClick={()=>onSaveEdit(kw.id)} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100"><Check className="w-4 h-4"/></button><button onClick={onCancelEdit} className="p-1.5 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100"><X className="w-4 h-4"/></button></div>):(<button onClick={()=>onStartEdit(kw)} className="p-1.5 text-[#86868b] hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"><Edit2 className="w-4 h-4"/></button>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}           