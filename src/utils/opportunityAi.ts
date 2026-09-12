// M4 · 机会卡 AI 生成（PRD §6.5「生成」/ 断链 #6 修复）。
//
// 这个模块替代了 phase-0 的 opportunityAi.ts：那份实现挂在一个已经不存在的数据模型上
// （SelfGuidingQuestion / OpportunityScoreBreakdown / accountBackgroundSnapshot），
// 而且它的"自身出题"职责已被 M3 的品类选择题（categoryQuiz）接管。
//
// 它只做三件事，每一件都守住同一条红线 —— **AI 生成内容，系统决定数字**：
//   1) generateOpportunityCandidates：把四看证据拼成 prompt，让 AI 出 0-N 条候选卡；
//      返回的卡片全部经 normalizeOpportunityCard 清洗，评分/覆盖度/状态/决策由确定性逻辑接管；
//   2) reviewOpportunityCard：对一张卡做"反证审查"（找出可能推翻它的证据 + 还缺什么证据）；
//   3) 绝不因 AI 返回 0 条而删除任何人工已确认的卡（由调用方的合并规则保证，见 mergeGeneratedCards）。

import { generateText, loadAiSettings } from './aiConfig';
import { buildUserBackgroundSystemPrompt } from './userBackground';
import { tryParseJson } from './lookAi';
import { loadUserLook } from './userLook';
import { loadMarketLook } from './marketLook';
import { loadCompetitorLook } from './competitorLook';
import { loadSelfAssessment } from './selfAssessment';
import { loadSnapshot } from './projectSnapshot';
import { loadEvidence, describeEvidence } from './evidence';
import { normalizeOpportunityCard, createOpportunityId } from './opportunityStore';
import { scoreOpportunityV2, SCORE_WEIGHTS } from './opportunityScoreV2';
import { buildDecisionPackage } from './opportunityPlan';
import { suggestConclusion } from './opportunityConclusion';
import { loadMarketSegmentContext } from './opportunityContext';
import { buildSatisfactionMatrix, buildPainMatrix } from './competitorAnalysis';
import { buildOurCapability, computeFitScore } from './ourCapability';
import { toAnswersForFit } from './categoryQuiz';
import { computeCompleteness, loadCapabilityLibrary } from './capabilityLibrary';
import type { OpportunityCard, ResearchProject } from '../types/researchProject';
import type { OpportunityConclusion } from '../types/opportunity';
import { CONFIDENCE_LABELS } from '../types/opportunity';

export interface OpportunityGenerationResult {
  ok: boolean;
  /** 清洗后的候选卡（评分/覆盖度已由确定性公式填好） */
  cards: OpportunityCard[];
  error?: string;
  reason?: 'no-key' | 'no-data' | 'parse' | 'other';
  /** 零机会结论（数据不足时给出；null = 数据支持机会或还没到判定的条件） */
  conclusion: OpportunityConclusion | null;
  /** 给用户看的说明（生成了几条、为什么是这个结论） */
  note: string;
}

/** 四看证据摘要（给 AI 的上下文；没有数据的地方明说没有，不让模型自己脑补） */
async function buildFourLookContext(userId: string, projectId: string): Promise<{
  text: string;
  evidenceIds: string[];
  needs: Awaited<ReturnType<typeof loadUserLook>>['unmetNeedCandidates'];
  satisfaction: Parameters<typeof suggestConclusion>[0]['satisfaction'];
  fitScore: number;
  fitAnswered: number;
  hardConstraint: { blocked: boolean; notes: string[] } | null;
  segmentOpportunity: number | undefined;
  hasTargetSegment: boolean;
  competitorCount: number;
  evidenceCount: number;
}> {
  const [snap, userLook, market, comp, self, evidence] = await Promise.all([
    loadSnapshot(userId, projectId),
    loadUserLook(userId, projectId),
    loadMarketLook(userId, projectId),
    loadCompetitorLook(userId, projectId),
    loadSelfAssessment(userId, projectId),
    loadEvidence(userId, projectId),
  ]);

  const needs = (userLook.unmetNeedCandidates ?? []).filter((n) => (n.needStatement || '').trim().length > 0);
  const lines: string[] = [];

  lines.push('【看用户 · 需求（含证据）】');
  if (needs.length === 0) lines.push('（还没有需求：先在看用户跑一次分析）');
  for (const n of needs.slice(0, 8)) {
    const ev = n.evidence ?? {};
    lines.push(
      `- [${n.id}] ${n.needStatement}（${n.category || '未分类'}${n.subCategory ? ` / ${n.subCategory}` : ''}）` +
        `｜关键词 ${(ev.keywords ?? []).map((k) => k.word).join('、') || '无'}` +
        `｜评论原文 ${(ev.reviewQuotes ?? []).length} 条｜覆盖 ASIN ${(ev.asins ?? []).length} 个`
    );
  }

  lines.push('【看市场 · 细分与机会分】');
  const segCtx = await loadMarketSegmentContext(userId, projectId, needs);
  if (segCtx.schemeName) lines.push(`方案：${segCtx.schemeName}`);
  for (const s of segCtx.targets.slice(0, 5)) {
    lines.push(`- ${s.name}：机会分 ${s.opportunity}（趋势 ${s.trend}/体量 ${s.volume}/竞争 ${s.competition}），商品 ${s.productCount} 个`);
  }
  lines.push(segCtx.targets.length === 0 ? `（${segCtx.note}）` : `（${segCtx.note}）`);

  lines.push('【看竞对 · 满足矩阵与痛点】');
  const columns = (comp.samplePool ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 5);
  const satisfaction = columns.map((asin) =>
    buildSatisfactionMatrix(asin, snap?.products.find((p) => p.asin === asin), snap?.reviews ?? [], needs, comp.listingDetails?.[asin])
  );
  if (columns.length === 0) lines.push('（还没有竞对样本池）');
  columns.forEach((asin, i) => {
    const m = satisfaction[i];
    lines.push(`- ${asin}：●满足 ${m.met} / ◐部分 ${m.partial} / ○未满足 ${m.unmet} / —未提及 ${m.unmentioned}`);
  });
  for (const asin of columns.slice(0, 3)) {
    const pain = buildPainMatrix(asin, snap?.reviews ?? [], needs);
    lines.push(`  ${asin} 痛点 TOP：${pain.hits.slice(0, 3).map((h) => `${h.label}×${h.count}`).join('、') || '无差评'}`);
  }

  lines.push('【看自己 · 适配与硬约束】');
  const capability = buildOurCapability({
    items: self.items,
    byNeedId: comp.ourCapabilityByNeedId ?? {},
    financials: comp.ourCapabilityFinancials,
  });
  const answersForFit = self.quiz ? toAnswersForFit(self.quiz) : {};
  const backgroundCompleteness = computeCompleteness(loadCapabilityLibrary(userId)).completeness;
  const fit = computeFitScore({ answers: answersForFit, backgroundCompleteness });
  lines.push(`适配度 ${fit.fitScore}/100（${fit.answered} 道相关题；${fit.note}）`);
  // 硬约束以"项目里已存好的结论"为准（M3 写入），没有再回退到自评推导
  const hardConstraint = self.hardConstraintVerdict ?? { blocked: capability.hardConstraintBlocked, notes: capability.hardConstraintNotes ?? [] };
  lines.push(`硬约束：${hardConstraint.blocked ? `已否决（${(hardConstraint.notes ?? []).join('；')}）` : '未触发'}`);

  lines.push('【Evidence（可引用的证据编号）】');
  if (evidence.length === 0) lines.push('（项目还没有 Evidence）');
  for (const e of evidence.slice(0, 20)) lines.push(`- [${e.id}] ${describeEvidence(e)}`);

  lines.push('【本项目的待验证问题（来自看市场）】');
  const qs = (market.openQuestions ?? []).filter((q) => String(q || '').trim());
  lines.push(qs.length ? qs.map((q) => `- ${q}`).join('\n') : '（无）');

  return {
    text: lines.join('\n'),
    evidenceIds: evidence.map((e) => e.id),
    needs,
    satisfaction,
    fitScore: fit.fitScore,
    fitAnswered: fit.answered,
    hardConstraint,
    segmentOpportunity: segCtx.targetOpportunity,
    hasTargetSegment: segCtx.targets.length > 0,
    competitorCount: columns.length,
    evidenceCount: evidence.length,
  };
}

/**
 * 生成候选机会卡（0-N）。
 * 三种合法结果：
 *  - ok=true, cards>0：有候选（全部为 ai_candidate，等你确认）
 *  - ok=true, cards=0, conclusion=judged_none：已判断无机会（写明卡点）
 *  - ok=false, conclusion=insufficient_evidence：证据不足（写明缺什么）
 */
export async function generateOpportunityCandidates(
  userId: string,
  project: ResearchProject
): Promise<OpportunityGenerationResult> {
  const settings = loadAiSettings();
  if (!settings.apiKey) {
    return {
      ok: false,
      cards: [],
      reason: 'no-key',
      error: '尚未配置 AI 模型 Key，请先到「设置 → API 与模型」填写。',
      conclusion: null,
      note: '这不是"没机会"，是没配置模型。',
    };
  }

  const ctx = await buildFourLookContext(userId, project.id);

  // 数据不足 → 直接给"证据不足"结论，不浪费一次调用，也不让模型编机会
  const suggestion = suggestConclusion({
    needs: ctx.needs,
    satisfaction: ctx.satisfaction,
    segmentOpportunity: ctx.segmentOpportunity,
    hasTargetSegment: ctx.hasTargetSegment,
    fitScore: ctx.fitScore,
    fitAnswered: ctx.fitAnswered,
    hardConstraint: ctx.hardConstraint,
    competitorCount: ctx.competitorCount,
    evidenceCount: ctx.evidenceCount,
  });
  if (suggestion.conclusion && suggestion.conclusion.kind === 'insufficient_evidence') {
    return { ok: false, cards: [], reason: 'no-data', conclusion: suggestion.conclusion, note: suggestion.rationale, error: suggestion.conclusion.reason };
  }
  if (suggestion.conclusion && suggestion.conclusion.kind === 'judged_none') {
    return { ok: true, cards: [], conclusion: suggestion.conclusion, note: suggestion.rationale };
  }

  const system = `你是亚马逊选品决策顾问，负责把「四看」证据收敛成可执行的机会卡。${buildUserBackgroundSystemPrompt() ? `\n\n${buildUserBackgroundSystemPrompt()}` : ''}
硬规则（违反即视为无效输出）：
1) 只基于提供的证据，禁止编造数字、ASIN、评论原文或市场规模；
2) 没有证据支撑的字段留空字符串，不要用套话填充；
3) 你**不负责打分**：评分由系统按确定性公式计算，禁止输出 score/coverage；
4) 每条机会必须挂 unmetNeedId（只能从提供的需求 id 里选）与至少一条 evidenceRefs；
5) 证据不足时宁可少给机会，甚至给 0 条，也不要凑数。
请严格输出 JSON，不要 Markdown 代码块。`;

  const prompt = `请基于以下四看证据，生成 0-3 条机会卡候选（只输出真实有证据支撑的）。输出 JSON：
{
  "cards": [
    {
      "title": "机会名称（人话，≤20 字）",
      "unmetNeedId": "必须来自下面需求列表的 id",
      "needStatement": "对应需求",
      "targetUser": "目标人群",
      "scenario": "使用场景",
      "jobToBeDone": "用户要完成的任务",
      "solutionHypothesis": "产品假设（怎么满足这条需求）",
      "currentAlternative": "用户现在的替代方案",
      "kind": "new_product|improve_existing|bundle|niche",
      "confidence": "low|medium|high（依据证据覆盖，不要随口给 high）",
      "evidenceRefs": [{"evidenceId": "必须是下面列出的证据编号", "sourceRef": "原始来源", "summary": "这条证据说明什么"}],
      "reasoningSteps": [{"step": "推理步骤（≤8 字）", "detail": "怎么从证据推到这个结论", "evidenceIds": ["证据编号"]}],
      "counterEvidence": ["可能推翻这个机会的反证（没有就空数组，不要写套话）"],
      "missingEvidence": ["还缺什么证据才能把这张卡做实"],
      "profitAssumption": {"price": 45, "cost": 12, "cpc": 1.2},
      "risks": [{"category": "demand|competition|product|supply|compliance|profit", "label": "风险", "description": "", "severity": "low|medium|high", "mitigation": "缓解方案"}],
      "validationActions": [{"action": "验证动作", "owner": "", "successCriteria": "成功标准"}]
    }
  ]
}
四看证据：
${ctx.text}`;

  try {
    const raw = await generateText(prompt, settings, { jsonMode: true, systemPrompt: system });
    const parsed = tryParseJson<Record<string, unknown>>(raw);
    if (!parsed) {
      return { ok: false, cards: [], reason: 'parse', error: 'AI 返回格式无法解析，请重试。', conclusion: null, note: '解析失败，未产生任何卡（不会覆盖你已有的机会卡）' };
    }
    const rows = Array.isArray(parsed.cards) ? (parsed.cards as Record<string, unknown>[]) : [];

    const cards: OpportunityCard[] = [];
    for (const row of rows) {
      const cleaned = normalizeOpportunityCard(row, project.id);
      if (!cleaned) continue;
      // 需求 id 必须在真实需求列表里（AI 常编 id）
      const needId = ctx.needs.some((n) => n.id === cleaned.unmetNeedId) ? cleaned.unmetNeedId : '';
      const need = ctx.needs.find((n) => n.id === needId) ?? null;
      // 证据引用必须指向真实存在的 Evidence（AI 常编编号）
      const refs = (cleaned.evidenceRefs ?? []).filter((r) => ctx.evidenceIds.includes(r.evidenceId));
      const score = scoreOpportunityV2({
        need,
        segmentOpportunity: ctx.segmentOpportunity,
        hasTargetSegment: ctx.hasTargetSegment,
        satisfaction: ctx.satisfaction,
        fitScore: ctx.fitScore,
        fitAnswered: ctx.fitAnswered,
        evidence: (await loadEvidence(userId, project.id)).filter((e) => refs.some((r) => r.evidenceId === e.id)),
      });
      // 决策包由确定性规则补全（AI 给的会被系统版本覆盖掉缺失部分）
      const pkg = cleaned.decisionPackage && cleaned.decisionPackage.roadmap.length > 0
        ? cleaned.decisionPackage
        : buildDecisionPackage({ need, profit: cleaned.profitAssumption ?? null, risks: cleaned.risks });

      cards.push({
        ...cleaned,
        id: cleaned.id || createOpportunityId(),
        unmetNeedId: needId,
        evidenceRefs: refs,
        score: score.total,
        coverage: score.coverage,
        scoreBreakdown: {
          demandStrength: score.dimensionScores.demandStrength ?? 0,
          marketOpportunity: score.dimensionScores.marketOpportunity ?? 0,
          competitorGap: score.dimensionScores.competitorGap ?? 0,
          selfFit: score.dimensionScores.selfFit ?? 0,
          evidenceConfidence: score.dimensionScores.evidenceConfidence ?? 0,
          weights: (await import('./opportunityScoreV2')).SCORE_WEIGHTS,
          total: score.total,
        },
        // 硬约束否决 → 进入方式最多"验证后进入"（§6.4）
        enterMode: ctx.hardConstraint?.blocked ? 'validate_first' : cleaned.enterMode === 'direct' ? 'direct' : 'validate_first',
        confidence: cleaned.confidence ?? 'low',
        decisionPackage: pkg,
        status: 'ai_candidate',
        decision: 'undecided',
      });
    }

    if (cards.length === 0) {
      return {
        ok: true,
        cards: [],
        conclusion: {
          kind: 'insufficient_evidence',
          reason: 'AI 没有产出有证据支撑的机会卡（这属于"证据不足"，不是"已判断无机会"）',
          missingData: ['更完整的评论样本', '目标细分的竞对满足矩阵', '自有能力的品类选择题答案'],
          confirmed: false,
          updatedAt: new Date().toISOString(),
        },
        note: 'AI 返回 0 条：已按"证据不足"处理（不会删除你已有的机会卡）',
      };
    }

    return {
      ok: true,
      cards,
      conclusion: null,
      note: `生成 ${cards.length} 条 AI 候选（状态均为 ai_candidate，请逐条核对证据后再确认）`,
    };
  } catch (e) {
    return {
      ok: false,
      cards: [],
      reason: 'other',
      error: e instanceof Error ? e.message : 'AI 生成失败',
      conclusion: null,
      note: '生成失败：未产生任何卡（不会覆盖你已有的机会卡）',
    };
  }
}

/**
 * 反证审查（二级页⑬「反证」栏）：让 AI 专找"可能推翻这张卡"的证据与缺失证据。
 * 只写 counterEvidence / missingEvidence 两个字段，不碰评分与决策。
 */
export async function reviewOpportunityCard(
  card: OpportunityCard,
  contextText: string
): Promise<{ ok: boolean; counterEvidence?: string[]; missingEvidence?: string[]; error?: string }> {
  const settings = loadAiSettings();
  if (!settings.apiKey) return { ok: false, error: '尚未配置 AI 模型 Key' };
  const system = '你是选品决策的反方审查员。你的任务是尽力找出能推翻这个机会的证据，而不是附和。禁止编造数据。只输出 JSON。';
  const prompt = `请审查这张机会卡，输出 JSON：
{"counterEvidence": ["可能推翻它的证据或逻辑漏洞（2-4 条，没有就空数组）"], "missingEvidence": ["还缺哪些证据才能确认（2-4 条）"]}
机会卡：${card.title}
需求：${card.needStatement}
产品假设：${card.solutionHypothesis}
已有证据：${contextText}
注意：不要重复"已有证据"里已经成立的内容，只说你怀疑或缺失的部分。`;
  try {
    const raw = await generateText(prompt, settings, { jsonMode: true, systemPrompt: system });
    const parsed = tryParseJson<Record<string, unknown>>(raw);
    if (!parsed) return { ok: false, error: 'AI 返回格式无法解析' };
    const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6) : []);
    return { ok: true, counterEvidence: arr(parsed.counterEvidence), missingEvidence: arr(parsed.missingEvidence) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '审查失败' };
  }
}

/**
 * 合并 AI 生成结果（非破坏性，沿用 phase-0 防线）：
 * - 已有人工确认（status='confirmed'）或已做过决策（decision!=='undecided'）的卡**一张都不动**；
 * - AI 返回 0 条**不删除**任何已有卡；
 * - 新候选按 unmetNeedId 去重：同一需求已有卡就不重复加（只补 evidenceRefs 里缺的证据引用）。
 */
export function mergeGeneratedCards(
  existing: OpportunityCard[],
  generated: OpportunityCard[]
): { next: OpportunityCard[]; added: number; skipped: number; preserved: number } {
  const next = [...existing];
  let added = 0;
  let skipped = 0;
  let preserved = 0;
  for (const g of generated) {
    const dup = next.find((c) => c.unmetNeedId && c.unmetNeedId === g.unmetNeedId);
    if (!dup) {
      next.push(g);
      added += 1;
      continue;
    }
    if (dup.status === 'confirmed' || dup.decision !== 'undecided') {
      preserved += 1;
      skipped += 1;
      continue;
    }
    // 未确认的重复卡：补齐证据引用，其余保持人工/AI 已写内容
    const ids = new Set((dup.evidenceRefs ?? []).map((r) => r.evidenceId));
    const extra = (g.evidenceRefs ?? []).filter((r) => !ids.has(r.evidenceId));
    if (extra.length > 0) {
      const idx = next.findIndex((c) => c.id === dup.id);
      next[idx] = { ...dup, evidenceRefs: [...(dup.evidenceRefs ?? []), ...extra], updatedAt: new Date().toISOString() };
    }
    skipped += 1;
  }
  return { next, added, skipped, preserved };
}

/** 可信度标签（UI 直接用，避免各处自己拼） */
export function confidenceLabel(card: OpportunityCard): string {
  return CONFIDENCE_LABELS[card.confidence ?? 'low'];
}
