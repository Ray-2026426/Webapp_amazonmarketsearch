import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { Users, Route, Lightbulb, Sparkles, Package, Target, ChevronRight } from 'lucide-react';
import type { AiInsight } from './KeywordAnalysis';

/** 决策路径四阶段分色：认知紫 / 考虑蓝 / 决策绿 / 使用琥珀 */
export const DECISION_STAGE_STYLES = [
  { bg: 'bg-violet-50', border: 'border-violet-200', ring: 'bg-violet-100', text: 'text-violet-700', accent: '#8b5cf6' },
  { bg: 'bg-blue-50', border: 'border-blue-200', ring: 'bg-blue-100', text: 'text-blue-700', accent: '#3b82f6' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', ring: 'bg-emerald-100', text: 'text-emerald-700', accent: '#10b981' },
  { bg: 'bg-amber-50', border: 'border-amber-200', ring: 'bg-amber-100', text: 'text-amber-700', accent: '#f59e0b' },
] as const;

function asList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => String(x || '').trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

function stageStyle(name: string, index: number) {
  const n = (name || '').toLowerCase();
  if (/认知|awareness|aware/.test(n)) return DECISION_STAGE_STYLES[0];
  if (/考虑|compar|consider/.test(n)) return DECISION_STAGE_STYLES[1];
  if (/决策|购买|decision|buy|purchase/.test(n)) return DECISION_STAGE_STYLES[2];
  if (/使用|忠诚|loyalty|use|post/.test(n)) return DECISION_STAGE_STYLES[3];
  return DECISION_STAGE_STYLES[index % DECISION_STAGE_STYLES.length];
}

/** 用户画像 + 决策路径（分色）+ 洞察结论 三块，关键词报告与评论洞察共用 */
export function InsightReportPanels({
  ins,
  evidenceLabel = '信号',
}: {
  ins: AiInsight;
  /** 决策阶段第三行字段名：关键词用「信号」，评论用「证据」 */
  evidenceLabel?: string;
}) {
  const scenes = asList(ins.userScenes);
  const needs = asList(ins.userNeeds);
  const pains = asList(ins.userPainPoints);
  const stages = Array.isArray(ins.decisionStages) ? ins.decisionStages : [];
  const listing = ins.listingPlan;
  const product = ins.productPlan;
  const roadmap = Array.isArray(ins.productRoadmap) ? ins.productRoadmap : [];
  const bullets = asList(listing?.bullets);
  const mustFix = asList(product?.mustFix);

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-black/5">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-violet-500" />用户画像</CardTitle>
          <CardDescription>谁在买 · 什么场景 · 要什么 · 卡在哪</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.userPersona || '—'}</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <div className="rounded-xl bg-[#f8f9fb] border border-black/5 p-4">
              <div className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wider mb-2">核心场景</div>
              <ul className="space-y-1.5">{scenes.length ? scenes.map(s => <li key={s} className="text-[13px] text-[#424245] flex gap-2"><span className="text-indigo-400">·</span>{s}</li>) : <li className="text-[13px] text-[#aeaeb2]">—</li>}</ul>
            </div>
            <div className="rounded-xl bg-[#f8f9fb] border border-black/5 p-4">
              <div className="text-[11px] font-semibold text-violet-600 uppercase tracking-wider mb-2">核心需求</div>
              <ul className="space-y-1.5">{needs.length ? needs.map(s => <li key={s} className="text-[13px] text-[#424245] flex gap-2"><span className="text-violet-400">·</span>{s}</li>) : <li className="text-[13px] text-[#aeaeb2]">—</li>}</ul>
            </div>
            <div className="rounded-xl bg-[#f8f9fb] border border-black/5 p-4">
              <div className="text-[11px] font-semibold text-rose-600 uppercase tracking-wider mb-2">主要痛点</div>
              <ul className="space-y-1.5">{pains.length ? pains.map(s => <li key={s} className="text-[13px] text-[#424245] flex gap-2"><span className="text-rose-400">·</span>{s}</li>) : <li className="text-[13px] text-[#aeaeb2]">—</li>}</ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-black/5">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><Route className="w-4 h-4 text-blue-500" />决策路径</CardTitle>
          <CardDescription>从搜到下单，用户怎么走（四阶段分色）</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-5">
          {stages.length > 0 ? (
            <div className="flex flex-col lg:flex-row gap-3 lg:items-stretch">
              {stages.map((st, i) => {
                const sty = stageStyle(st.name, i);
                return (
                  <div key={`${st.name}-${i}`} className="flex-1 relative">
                    <div className={`h-full rounded-2xl border ${sty.border} ${sty.bg} p-4`}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`w-6 h-6 rounded-full ${sty.ring} ${sty.text} text-[11px] font-bold flex items-center justify-center`}>{i + 1}</span>
                        <span className={`text-sm font-semibold ${sty.text}`}>{st.name}</span>
                      </div>
                      <p className="text-[13px] text-[#424245] leading-relaxed mb-2">{st.desc}</p>
                      {st.signals && <p className="text-[11px] text-[#86868b]">{evidenceLabel}：{st.signals}</p>}
                    </div>
                    {i < stages.length - 1 && (
                      <div className="hidden lg:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10 text-[#c7c7cc]">
                        <ChevronRight className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[#aeaeb2]">暂无分阶段路径</p>
          )}
          {ins.decisionSummary && (
            <p className="text-sm text-[#424245] leading-relaxed bg-[#f8f9fb] rounded-xl p-4 border border-black/5">{ins.decisionSummary}</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-indigo-50 via-violet-50 to-indigo-50 border-b border-black/5">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500" />洞察结论</CardTitle>
          <CardDescription>综合判断 → Listing / 产品 / 路线图</CardDescription>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <p className="text-sm text-[#1d1d1f] leading-relaxed">{ins.insightAnalysis || '—'}</p>

          <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
            <div className="flex items-center gap-2 mb-3"><Sparkles className="w-4 h-4 text-indigo-600" /><h4 className="text-sm font-semibold text-[#1d1d1f]">Listing 方案建议</h4></div>
            <p className="text-[13px] text-[#1d1d1f] mb-3"><span className="text-[#86868b]">标题方向：</span>{listing?.title || '—'}</p>
            {bullets.length > 0 && (
              <ul className="space-y-1.5 mb-3">
                {bullets.map(b => <li key={b} className="text-[13px] text-[#424245] flex gap-2"><span className="text-indigo-500 font-bold">·</span>{b}</li>)}
              </ul>
            )}
            <div className="grid sm:grid-cols-2 gap-3 text-[13px]">
              <div className="rounded-xl bg-white/80 p-3 border border-indigo-100/60"><span className="text-[#86868b]">关键词布局：</span>{listing?.keywords || '—'}</div>
              <div className="rounded-xl bg-white/80 p-3 border border-indigo-100/60"><span className="text-[#86868b]">视觉策略：</span>{listing?.visual || '—'}</div>
            </div>
          </div>

          <div className="rounded-2xl border border-violet-100 bg-violet-50/40 p-5">
            <div className="flex items-center gap-2 mb-3"><Package className="w-4 h-4 text-violet-600" /><h4 className="text-sm font-semibold text-[#1d1d1f]">产品方案建议</h4></div>
            <div className="grid sm:grid-cols-3 gap-3 text-[13px] mb-3">
              <div className="rounded-xl bg-white/80 p-3 border border-violet-100/60"><div className="text-[11px] text-[#86868b] mb-1">核心规格</div>{product?.core || '—'}</div>
              <div className="rounded-xl bg-white/80 p-3 border border-violet-100/60"><div className="text-[11px] text-[#86868b] mb-1">差异化</div>{product?.differentiation || '—'}</div>
              <div className="rounded-xl bg-white/80 p-3 border border-violet-100/60"><div className="text-[11px] text-[#86868b] mb-1">价格带</div>{product?.priceRange || '—'}</div>
            </div>
            {mustFix.length > 0 && (
              <div className="mb-4">
                <div className="text-[11px] font-semibold text-rose-600 mb-1.5">必改项</div>
                <ul className="space-y-1">{mustFix.map(x => <li key={x} className="text-[13px] text-[#424245] flex gap-2"><span className="text-rose-400">·</span>{x}</li>)}</ul>
              </div>
            )}
            {product?.parentStructure && (
              <div className="rounded-xl bg-white/90 border border-violet-100 p-4">
                <div className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider mb-1">父体结构建议</div>
                <p className="text-[13px] text-[#424245] mb-3 leading-relaxed">{product.parentStructure.summary || '—'}</p>
                <div className="space-y-2">
                  {(product.parentStructure.variants || []).map((v, i) => (
                    <div key={`${v.name}-${i}`} className="flex gap-3 items-start rounded-lg bg-violet-50/60 border border-violet-100/70 px-3 py-2.5">
                      <span className="text-[10px] font-bold text-violet-700 bg-white px-2 py-0.5 rounded-full border border-violet-100 shrink-0">{v.priority || `P${i}`}</span>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-[#1d1d1f]">{v.name} <span className="text-[11px] font-medium text-violet-600">· {v.role}</span></div>
                        <div className="text-[12px] text-[#86868b] mt-0.5 leading-relaxed">{v.rationale}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2"><Target className="w-4 h-4 text-emerald-600" /><h4 className="text-sm font-semibold text-[#1d1d1f]">产品路线图（产品矩阵）</h4></div>
            <p className="text-[12px] text-[#86868b] mb-3 leading-relaxed">不是简单列款名——每阶段说明「先做谁、为什么、要验证什么」，方便评审拍板节奏。</p>
            {roadmap.length ? (
              <div className="grid sm:grid-cols-3 gap-3">
                {roadmap.map((r, i) => (
                  <div key={`${r.phase}-${i}`} className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                    <div className="text-[11px] font-semibold text-emerald-700 mb-1">{r.phase || `P${i + 1}`} · {r.priority || '—'}</div>
                    <div className="text-sm font-semibold text-[#1d1d1f] mb-1">{r.name || '—'}</div>
                    <div className="text-[12px] text-[#86868b] mb-2">目标：{r.target || '—'}</div>
                    {r.rationale && <p className="text-[12px] text-[#424245] leading-relaxed border-t border-emerald-100/80 pt-2">{r.rationale}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#aeaeb2]">暂无路线图</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function tryParseAiInsight(raw: string): AiInsight | null {
  try {
    const cleaned = raw.replace(/^```(?:json|html)?\s*\n?/i, '').replace(/\n?```\s*$/, '').trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    const obj = JSON.parse(m ? m[0] : cleaned);
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.userPersona && !obj.insightAnalysis && !obj.decisionStages) return null;
    return {
      userPersona: String(obj.userPersona || ''),
      userScenes: asList(obj.userScenes),
      userNeeds: asList(obj.userNeeds),
      userPainPoints: asList(obj.userPainPoints),
      decisionStages: Array.isArray(obj.decisionStages)
        ? obj.decisionStages.map((s: any) => ({
            name: String(s?.name || ''),
            desc: String(s?.desc || ''),
            signals: String(s?.signals || s?.evidence || ''),
          }))
        : [],
      decisionSummary: String(obj.decisionSummary || ''),
      insightAnalysis: String(obj.insightAnalysis || ''),
      listingPlan: {
        title: String(obj.listingPlan?.title || ''),
        bullets: asList(obj.listingPlan?.bullets),
        keywords: String(obj.listingPlan?.keywords || ''),
        visual: String(obj.listingPlan?.visual || ''),
      },
      productPlan: {
        core: String(obj.productPlan?.core || ''),
        differentiation: String(obj.productPlan?.differentiation || ''),
        priceRange: String(obj.productPlan?.priceRange || ''),
        mustFix: asList(obj.productPlan?.mustFix),
        parentStructure: obj.productPlan?.parentStructure ? {
          summary: String(obj.productPlan.parentStructure.summary || ''),
          variants: Array.isArray(obj.productPlan.parentStructure.variants)
            ? obj.productPlan.parentStructure.variants.map((v: any) => ({
                name: String(v?.name || ''),
                role: String(v?.role || ''),
                priority: String(v?.priority || ''),
                rationale: String(v?.rationale || ''),
              }))
            : [],
        } : undefined,
      },
      productRoadmap: Array.isArray(obj.productRoadmap)
        ? obj.productRoadmap.map((r: any) => ({
            phase: String(r?.phase || ''),
            name: String(r?.name || ''),
            target: String(r?.target || ''),
            priority: String(r?.priority || ''),
            rationale: String(r?.rationale || ''),
          }))
        : [],
    };
  } catch {
    return null;
  }
}
