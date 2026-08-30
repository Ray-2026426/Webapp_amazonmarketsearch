import type { OpportunityCard, ResearchProject } from '../types/researchProject';
import { loadUserLook } from './userLook';
import { loadMarketLook } from './marketLook';
import { loadCompetitorLook } from './competitorLook';
import { loadSelfAssessment } from './selfAssessment';
import { loadOpportunities, loadOpportunityConclusion } from './opportunityStore';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function list(items: string[], empty = '暂无'): string {
  const valid = items.map((item) => item.trim()).filter(Boolean);
  return valid.length ? `<ul>${valid.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`;
}

function opportunity(card: OpportunityCard): string {
  const type = card.opportunityType === 'market_growth' ? '市场增长 / 供需机会' : '竞对未满足需求';
  const scores = [
    ['需求强度', card.scoreBreakdown?.demandStrength ?? 0, 25],
    ['市场机会', card.scoreBreakdown?.marketOpportunity ?? 0, 25],
    ['竞对缺口', card.scoreBreakdown?.competitorGap ?? 0, 25],
    ['自身适配', card.scoreBreakdown?.selfFit ?? 0, 15],
    ['证据可信', card.scoreBreakdown?.evidenceConfidence ?? 0, 10],
  ] as const;
  return `<article class="opportunity">
    <div class="opportunity-head"><div><span class="eyebrow">${escapeHtml(type)}</span><h3>${escapeHtml(card.title)}</h3></div><strong>${card.score} 分</strong></div>
    <p class="lead">${escapeHtml(card.needStatement)}</p>
    <div class="grid"><div><h4>目标用户与场景</h4>${list([card.targetUser, card.scenario, card.jobToBeDone])}</div><div><h4>解决假设</h4>${list([card.solutionHypothesis])}</div></div>
    <h4>机会评分与证据覆盖</h4><div class="score-grid">${scores.map(([label, value, max]) => `<div class="score"><span>${label}</span><div><i style="width:${Math.round((value / max) * 100)}%"></i></div><b>${value}/${max}</b></div>`).join('')}</div><p class="muted">证据覆盖度：${Math.round((card.coverage ?? 0) * 100)}% · 置信度：${escapeHtml(card.confidence ?? 'low')} · 人工状态：${card.reviewStatus === 'confirmed' ? '已确认' : 'AI 候选'}</p>
    <h4>原始证据</h4>${list((card.evidenceRefs ?? []).map((ref) => `[${ref.look}] ${ref.label}：${ref.excerpt}`))}
    <h4>推理过程</h4>${list((card.reasoning ?? []).map((step) => `${step.judgement} → ${step.conclusion}`))}
    <div class="grid"><div><h4>反证 / 冲突</h4>${list(card.counterEvidence ?? [])}</div><div><h4>缺失证据</h4>${list(card.missingEvidence ?? [])}</div></div>
    <h4>人工修改记录</h4>${list((card.humanEdits ?? []).map((edit) => `${new Date(edit.at).toLocaleString('zh-CN')} · ${edit.summary}`), '没有人工修改')}
  </article>`;
}

export async function buildOpportunityHtmlReport(userId: string, project: ResearchProject): Promise<string> {
  const [user, market, competitor, self, cards, conclusion] = await Promise.all([
    loadUserLook(userId, project.id),
    loadMarketLook(userId, project.id),
    loadCompetitorLook(userId, project.id),
    loadSelfAssessment(userId, project.id),
    loadOpportunities(userId, project.id),
    loadOpportunityConclusion(userId, project.id),
  ]);
  const confirmed = cards.filter((card) => card.reviewStatus === 'confirmed');
  const outcome = conclusion?.resultStatus === 'no_opportunity'
    ? '当前没有达到立项标准的机会'
    : conclusion?.resultStatus === 'insufficient_evidence'
      ? '证据不足，暂不能判断是否存在机会'
      : confirmed.length
        ? `已确认 ${confirmed.length} 个机会`
        : `有 ${cards.length} 个 AI 候选机会待审核`;
  const answerItems = (self.guidingQuestions ?? []).filter((q) => q.answer.trim()).map((q) => `${q.question}：${q.answer}`);

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(project.name)} · 机会洞察报告</title>
  <style>body{margin:0;background:#f5f5f7;color:#1d1d1f;font:14px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{max-width:980px;margin:0 auto;padding:48px 24px}.hero,.section,.opportunity{background:#fff;border:1px solid rgba(0,0,0,.07);border-radius:24px;padding:28px;margin-bottom:18px}.hero{background:linear-gradient(135deg,#eef2ff,#fff 55%,#f5f3ff)}h1{font-size:34px;line-height:1.2;margin:6px 0 10px}h2{font-size:20px;margin:0 0 12px}h3{font-size:18px;margin:4px 0}h4{font-size:12px;margin:16px 0 6px;color:#6366f1}.eyebrow{color:#6366f1;font-size:12px;font-weight:700;text-transform:uppercase}.lead{font-size:16px}.muted{color:#86868b}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.opportunity-head{display:flex;justify-content:space-between;gap:20px}.opportunity-head strong{color:#4f46e5;font-size:24px}.score-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.score{background:#fafafa;border-radius:12px;padding:10px}.score span,.score b{display:block;font-size:11px}.score b{margin-top:4px;color:#4f46e5}.score div{height:6px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin-top:7px}.score i{display:block;height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:99px}ul{padding-left:20px;margin:6px 0}.meta{color:#6b7280}.status{display:inline-block;border-radius:999px;background:#4f46e5;color:white;padding:5px 12px;font-weight:700}@media(max-width:700px){.grid{grid-template-columns:1fr}.score-grid{grid-template-columns:1fr 1fr}.page{padding:20px 12px}h1{font-size:26px}}@media print{body{background:#fff}.page{max-width:none;padding:0}.hero,.section,.opportunity{break-inside:avoid}}</style></head><body><main class="page">
    <section class="hero"><span class="eyebrow">Amazon unmet-needs research</span><h1>${escapeHtml(project.name)}</h1><p class="meta">${escapeHtml(project.marketplace)} · ${escapeHtml(project.objective)} · 导出时间 ${escapeHtml(new Date().toLocaleString('zh-CN'))}</p><p><span class="status">${escapeHtml(outcome)}</span></p>${list(conclusion?.reasons ?? [], '暂无额外说明')}</section>
    <section class="section"><h2>看用户：需求分类</h2>${list(user.unmetNeedCandidates.map((need) => `${need.category || '未分类'}｜${need.targetUser}｜${need.scenario}｜JTBD：${need.jobToBeDone}｜未满足：${need.unmetPart || need.needStatement}`))}</section>
    <section class="section"><h2>看市场：细分判断</h2><p class="lead">${escapeHtml(market.selectedOpportunitySegment || '未选择目标细分')}</p>${list([market.attractiveness, ...market.keyEvidences])}</section>
    <section class="section"><h2>看竞对：如何赢</h2><p class="lead">${escapeHtml(competitor.winningStrategy || '尚未形成取胜策略')}</p><div class="grid"><div><h4>产品力</h4>${list(competitor.productPowerFindings)}</div><div><h4>运营力</h4>${list(competitor.operationPowerFindings)}</div></div><h4>可攻击缝隙</h4>${list(competitor.gaps)}</section>
    <section class="section"><h2>看自己：能力边界</h2>${list(answerItems, '尚未回答当前品类的引导问题')}</section>
    <section class="section"><h2>看机会：结论与审核</h2><p class="muted">AI 候选 ${cards.filter((card) => card.reviewStatus !== 'confirmed').length} 个；人工确认 ${confirmed.length} 个。机会数量允许为 0。</p></section>
    ${cards.slice().sort((a, b) => Number(b.reviewStatus === 'confirmed') - Number(a.reviewStatus === 'confirmed') || b.score - a.score).map(opportunity).join('')}
  </main></body></html>`;
}

export function downloadHtmlReport(html: string, fileName: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
