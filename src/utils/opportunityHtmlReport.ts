// M4 · 独立 HTML 审核报告（PRD §6.5 产出物 + 二级页㉑；对应 phase-0 的 opportunityHtmlReport）。
//
// 一份可以直接双击打开、发给管理层的审核件。硬要求：
// - 只渲染存在的字段，**缺数据就写"未提供"**，不编造；
// - 评分拆解、证据引用、决策包（路线图/前置资源/控制点）必须同屏（§8.1 硬规则④：高分≠立项）；
// - 零机会结论也要能导出（无机会本身就是要评审的结论）。
//
// 纯函数渲染（buildOpportunityReportHtml）与 IO 分离，便于测试与复用。

import type { OpportunityCard, ResearchProject } from '../types/researchProject';
import type { OpportunityConclusion } from '../types/opportunity';
import {
  CONTROL_POINT_LABELS,
  NO_OPPORTUNITY_LABELS,
  OPPORTUNITY_KIND_LABELS,
  RESOURCE_CATEGORY_LABELS,
  ROADMAP_PHASE_LABELS,
} from '../types/opportunity';
import { SCORE_DIMENSION_LABELS, SCORE_WEIGHTS, type ScoreDimension } from './opportunityScoreV2';
import { PROJECT_DECISION_LABELS, loadProjectDecisionSummary, type ProjectDecisionSummary } from './projectDecision';
import { loadOpportunities, loadOpportunityConclusion } from './opportunityStore';
import { loadSelfAssessment } from './selfAssessment';
import { loadUserLook } from './userLook';
import { loadMarketLook } from './marketLook';
import { loadCompetitorLook } from './competitorLook';
import { CONFIDENCE_LABELS } from '../types/opportunity';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(v?: number): string {
  return typeof v === 'number' && Number.isFinite(v) ? `$${Math.round(v).toLocaleString()}` : '未提供';
}

function bar(score: number): string {
  const filled = Math.max(0, Math.min(10, Math.round(score / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${score}`;
}

function renderCard(card: OpportunityCard, index: number): string {
  const pkg = card.decisionPackage;
  const rows: string[] = [];

  rows.push(`<h3>#O${index + 1} ${escapeHtml(card.title)}</h3>`);
  rows.push(
    `<p class="meta">类型：${escapeHtml(OPPORTUNITY_KIND_LABELS[card.kind ?? 'new_product'])} ｜ 可信度：${escapeHtml(
      CONFIDENCE_LABELS[card.confidence ?? 'low']
    )} ｜ 状态：${card.status === 'confirmed' ? '已确认' : 'AI 候选（待确认）'} ｜ 决策：${escapeHtml(
      card.decision === 'undecided' ? '未拍板' : card.decision
    )}</p>`
  );
  if (card.enterMode === 'validate_first') {
    rows.push(`<p class="warn">⚠ 硬约束未通过：本机会最高只能"验证后进入"，不得推荐"直接进入"。</p>`);
  }

  rows.push('<table class="kv">');
  rows.push(`<tr><th>需求</th><td>${escapeHtml(card.needStatement) || '未提供'}</td></tr>`);
  rows.push(`<tr><th>目标人群</th><td>${escapeHtml(card.targetUser) || '未提供'}</td></tr>`);
  rows.push(`<tr><th>场景</th><td>${escapeHtml(card.scenario) || '未提供'}</td></tr>`);
  rows.push(`<tr><th>JTBD</th><td>${escapeHtml(card.jobToBeDone) || '未提供'}</td></tr>`);
  rows.push(`<tr><th>产品假设</th><td>${escapeHtml(card.solutionHypothesis) || '未提供'}</td></tr>`);
  rows.push(
    `<tr><th>利润假设</th><td>${
      card.profitAssumption
        ? `售价 ${money(card.profitAssumption.price)} / 采购 ${money(card.profitAssumption.cost)} / CPC ${money(card.profitAssumption.cpc)}`
        : '未提供（建议用侧栏利润计算器精算）'
    }</td></tr>`
  );
  rows.push('</table>');

  // 评分拆解（五维 + 覆盖度）
  const b = card.scoreBreakdown;
  rows.push('<h4>评分拆解（确定性公式，AI 不参与）</h4>');
  if (b) {
    rows.push('<table class="kv">');
    (Object.keys(SCORE_WEIGHTS) as ScoreDimension[]).forEach((d) => {
      rows.push(`<tr><th>${SCORE_DIMENSION_LABELS[d]}（权重 ${SCORE_WEIGHTS[d]}）</th><td class="mono">${bar(b[d])}</td></tr>`);
    });
    rows.push(`<tr><th>综合分</th><td class="mono">${bar(b.total)}</td></tr>`);
    rows.push(`<tr><th>数据覆盖度（独立展示，不进 100 分）</th><td>${(card.coverage * 100).toFixed(0)}%</td></tr>`);
    rows.push('</table>');
  } else {
    rows.push(`<p class="meta">未提供评分拆解（综合分 ${card.score}／覆盖度 ${(card.coverage * 100).toFixed(0)}%）</p>`);
  }

  // 证据
  rows.push('<h4>证据（可追溯）</h4>');
  if ((card.evidenceRefs ?? []).length > 0) {
    rows.push('<ul>');
    for (const e of card.evidenceRefs ?? []) {
      rows.push(`<li><span class="mono">${escapeHtml(e.sourceRef || e.evidenceId)}</span> — ${escapeHtml(e.summary)}</li>`);
    }
    rows.push('</ul>');
  } else {
    rows.push('<p class="meta">未提供证据引用</p>');
  }

  // 推理 / 反证（二级页⑬ 三栏的导出形态）
  if ((card.reasoningSteps ?? []).length > 0) {
    rows.push('<h4>推理</h4><ol>');
    for (const s of card.reasoningSteps ?? []) {
      rows.push(`<li><b>${escapeHtml(s.step)}</b>：${escapeHtml(s.detail)}</li>`);
    }
    rows.push('</ol>');
  }
  if ((card.counterEvidence ?? []).length > 0) {
    rows.push('<h4>反证（可能推翻本机会）</h4><ul>');
    for (const c of card.counterEvidence ?? []) rows.push(`<li>${escapeHtml(c)}</li>`);
    rows.push('</ul>');
  }
  if ((card.missingEvidence ?? []).length > 0) {
    rows.push('<h4>还缺的证据</h4><ul>');
    for (const c of card.missingEvidence ?? []) rows.push(`<li>${escapeHtml(c)}</li>`);
    rows.push('</ul>');
  }

  // 决策包
  rows.push('<h4>执行路线图</h4>');
  if (pkg && pkg.roadmap.length > 0) {
    for (const phase of ['now', 'next'] as const) {
      const items = pkg.roadmap.filter((a) => a.phase === phase);
      if (items.length === 0) continue;
      rows.push(`<p class="phase">${escapeHtml(ROADMAP_PHASE_LABELS[phase])}</p><ul>`);
      for (const a of items) {
        rows.push(
          `<li>${escapeHtml(a.action)}${typeof a.cost === 'number' ? `（成本约 ${money(a.cost)}）` : ''}${
            a.note ? `<br><span class="meta">${escapeHtml(a.note)}</span>` : ''
          }</li>`
        );
      }
      rows.push('</ul>');
    }
  } else {
    rows.push('<p class="meta">未提供路线图</p>');
  }

  rows.push('<h4>前置资源</h4>');
  if (pkg && pkg.resources.length > 0) {
    rows.push('<ul>');
    for (const r of pkg.resources) {
      rows.push(
        `<li>${r.knownGap ? '<span class="gap">[缺口]</span> ' : ''}${escapeHtml(RESOURCE_CATEGORY_LABELS[r.category])}｜${escapeHtml(
          r.label
        )}${r.note ? `<br><span class="meta">${escapeHtml(r.note)}</span>` : ''}</li>`
      );
    }
    rows.push('</ul>');
  } else {
    rows.push('<p class="meta">未提供资源清单</p>');
  }

  rows.push('<h4>控制点</h4>');
  if (pkg && pkg.controlPoints.length > 0) {
    for (const kind of ['entry', 'process', 'stop'] as const) {
      const items = pkg.controlPoints.filter((c) => c.kind === kind);
      if (items.length === 0) continue;
      rows.push(`<p class="phase">${escapeHtml(CONTROL_POINT_LABELS[kind])}</p><ul>`);
      for (const c of items) {
        rows.push(
          `<li>${c.confirmed ? '☑' : '☐'} ${escapeHtml(c.label)}：${escapeHtml(c.metric)} ${escapeHtml(c.threshold)}${
            c.confirmed ? '' : ' <span class="warn">（待确认）</span>'
          }</li>`
        );
      }
      rows.push('</ul>');
    }
  } else {
    rows.push('<p class="meta">未提供控制点</p>');
  }

  if (card.risks.length > 0) {
    rows.push('<h4>风险</h4><ul>');
    for (const r of card.risks) {
      rows.push(`<li>[${escapeHtml(r.severity)}] ${escapeHtml(r.label)}${r.mitigation ? `（缓解：${escapeHtml(r.mitigation)}）` : ''}</li>`);
    }
    rows.push('</ul>');
  }
  if (card.validationActions.length > 0) {
    rows.push('<h4>验证动作</h4><ul>');
    for (const v of card.validationActions) {
      rows.push(
        `<li>${escapeHtml(v.action)} ｜ owner：${escapeHtml(v.owner) || '未指定'} ｜ 截止：${escapeHtml(v.dueDate) || '未指定'} ｜ 成功标准：${escapeHtml(
          v.successCriteria
        ) || '未指定'}</li>`
      );
    }
    rows.push('</ul>');
  }

  return `<section class="card">${rows.join('\n')}</section>`;
}

function renderConclusion(conclusion: OpportunityConclusion | null, decision: ProjectDecisionSummary): string {
  const rows: string[] = [];
  rows.push('<h2>Go / No-Go 汇总</h2>');
  rows.push(`<p class="headline">${escapeHtml(decision.headline)}（${escapeHtml(PROJECT_DECISION_LABELS[decision.status])}）</p>`);
  rows.push('<ul>');
  for (const r of decision.reasons) rows.push(`<li>${escapeHtml(r)}</li>`);
  rows.push('</ul>');
  if (decision.nextAction) rows.push(`<p><b>下一步：</b>${escapeHtml(decision.nextAction)}</p>`);
  if (conclusion) {
    rows.push(
      `<p class="meta">零机会结论：${escapeHtml(NO_OPPORTUNITY_LABELS[conclusion.kind])} ｜ ${escapeHtml(conclusion.reason)}｜${
        conclusion.confirmed ? '已人工确认' : '待人工确认'
      }</p>`
    );
    if (conclusion.missingData?.length) {
      rows.push('<ul>');
      for (const m of conclusion.missingData) rows.push(`<li>缺：${escapeHtml(m)}</li>`);
      rows.push('</ul>');
    }
  }
  return rows.join('\n');
}

export interface OpportunityReportInput {
  project: ResearchProject;
  cards: OpportunityCard[];
  conclusion: OpportunityConclusion | null;
  decision: ProjectDecisionSummary;
  /** 四看摘要（人话；没有就写未提供） */
  fourLook: { user: string; market: string; competitor: string; self: string; hardConstraint: string };
}

/** 纯函数：整份报告的 HTML（无 IO，便于测试） */
export function buildOpportunityReportHtml(input: OpportunityReportInput): string {
  const { project, cards, conclusion, decision, fourLook } = input;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(project.name)} · 选品决策审核报告</title>
<style>
  body{font-family:-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;line-height:1.6;color:#1d1d1f;max-width:960px;margin:0 auto;padding:32px 20px;background:#fff}
  h1{font-size:24px;margin:0 0 4px}
  h2{font-size:18px;margin:28px 0 8px;padding-bottom:6px;border-bottom:2px solid #eef0ff}
  h3{font-size:16px;margin:20px 0 6px}
  h4{font-size:13px;margin:16px 0 4px;color:#4b5563}
  .meta{color:#6b7280;font-size:12px}
  .headline{font-size:18px;font-weight:700;color:#4338ca}
  .card{border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;margin:16px 0;background:#fcfcff}
  table.kv{width:100%;border-collapse:collapse;font-size:13px;margin:6px 0}
  table.kv th{text-align:left;width:34%;color:#6b7280;font-weight:600;vertical-align:top;padding:3px 8px 3px 0}
  table.kv td{padding:3px 0}
  .mono{font-family:ui-monospace,Consolas,monospace}
  .warn{color:#b45309;font-size:12px}
  .gap{color:#b91c1c;font-weight:700;font-size:12px}
  .phase{font-size:13px;font-weight:700;color:#374151;margin:8px 0 2px}
  ul,ol{margin:4px 0 8px 20px;padding:0}
  li{margin:2px 0;font-size:13px}
  footer{margin-top:32px;color:#9ca3af;font-size:12px;border-top:1px solid #eef0ff;padding-top:10px}
</style>
</head>
<body>
<h1>${escapeHtml(project.name)} · 选品决策审核报告</h1>
<p class="meta">站点 ${escapeHtml(project.marketplace)} ｜ 生成时间 ${escapeHtml(now)} ｜ 机会卡 ${cards.length} 张 ｜ 已拍板 ${decision.decidedCount} 张</p>
<p class="meta">本报告由确定性公式与可追溯证据生成：评分、控制点阈值、资源缺口均不由 AI 改写；缺数据的字段一律标注"未提供"。</p>

${renderConclusion(conclusion, decision)}

<h2>四看摘要</h2>
<table class="kv">
  <tr><th>看用户</th><td>${escapeHtml(fourLook.user) || '未提供'}</td></tr>
  <tr><th>看市场</th><td>${escapeHtml(fourLook.market) || '未提供'}</td></tr>
  <tr><th>看竞对</th><td>${escapeHtml(fourLook.competitor) || '未提供'}</td></tr>
  <tr><th>看自己</th><td>${escapeHtml(fourLook.self) || '未提供'}</td></tr>
  <tr><th>硬约束</th><td>${escapeHtml(fourLook.hardConstraint) || '未触发'}</td></tr>
</table>

<h2>机会卡（含决策包）</h2>
${cards.length > 0 ? cards.map((c, i) => renderCard(c, i)).join('\n') : '<p class="meta">没有机会卡（零机会结论见上方 Go / No-Go 汇总）</p>'}

<footer>Kairo · 亚马逊市场调研与选品决策 · 本文件可离线打开；评分与控制点口径见配套 PRD §6.5 / §8.1。</footer>
</body>
</html>`;
}

/** 组装四看摘要（人话，用于报告头部） */
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

/** IO 版：读数据 → 生成 HTML */
export async function buildOpportunityHtmlReport(userId: string, project: ResearchProject): Promise<string> {
  const [cards, conclusion, decision, fourLook] = await Promise.all([
    loadOpportunities(userId, project.id),
    loadOpportunityConclusion(userId, project.id),
    loadProjectDecisionSummary(userId, project),
    buildFourLookSummary(userId, project),
  ]);
  return buildOpportunityReportHtml({ project, cards, conclusion, decision, fourLook });
}

/** 触发浏览器下载（HTML 审核件） */
export function downloadHtmlReport(html: string, fileName: string): void {
  const safe = fileName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'report';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe.endsWith('.html') ? safe : `${safe}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
