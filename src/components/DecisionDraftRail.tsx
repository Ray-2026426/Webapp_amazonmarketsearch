import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Layers, RefreshCw, Sparkles } from 'lucide-react';
import { cn } from './ui/Card';
import { loadUserLook } from '../utils/userLook';
import { loadMarketLook } from '../utils/marketLook';
import { loadCompetitorLook } from '../utils/competitorLook';
import { loadSelfAssessment } from '../utils/selfAssessment';
import { loadEvidence, countEvidenceByLook, describeEvidence, EVIDENCE_LOOK_LABELS } from '../utils/evidence';
import {
  captureAndSaveSnapshot,
  loadSnapshot,
  snapshotSummary,
  describeSnapshot,
  hasSnapshotContent,
  type ProjectSnapshot,
  type SnapshotSummary,
} from '../utils/projectSnapshot';
import { FIVE_LOOK_LABELS, type FiveLookId, type ResearchProject } from '../types/researchProject';
import type { LookAiFailKind } from '../utils/lookAiFailure';

/**
 * 决策草稿（常驻右栏）—— 线框图 Screen 2 的"核心 IA 变化"。
 *
 * 线框图要求：右侧「决策草稿」**全程显示**进展与缺口（不是只在概览页出现）。
 * 所以这里由项目壳（ProjectWorkspace）在**所有 Tab** 上渲染，内容只反映"当前证据状态"：
 *   ① 已完成/未完成哪几看 → 下一步是哪一步（可一键跳过去）
 *   ② 未满足需求候选（只列前 3 条，答"有没有东西可做"）
 *   ③ 还缺什么（缺哪一看的什么内容，逐条点名）
 *   ④ 项目证据条数（按看分组 + 前几条摘要）
 *   ⑤ 项目数据快照（AI 与细分评分只认这份数据；可一键捕获/更新）
 *
 * 硬规则：这里**不编造机会**（机会结论只能由「看机会」生成），
 * 也不显示"完成度百分比"当主视觉（完成度 ≠ 决策质量）。
 */
export function DecisionDraftRail({
  userId,
  project,
  onGoto,
  refreshKey,
}: {
  userId: string;
  project: ResearchProject;
  /** 跳到某一看（线框图：草稿里要能直接"去复核 / 继续看机会"） */
  onGoto?: (look: FiveLookId) => void;
  /** 外部数据变化时递增，用来触发重算（例如向导跑完） */
  refreshKey?: number;
}) {
  const [draft, setDraft] = useState<{
    unmetCount: number;
    unmetTop: string[];
    missing: string[];
    evidenceTotal: number;
    evidenceByLook: Record<string, number>;
    evidenceTop: string[];
  } | null>(null);
  const [snap, setSnap] = useState<{ raw: ProjectSnapshot; summary: SnapshotSummary; text: string } | null>(null);
  const [snapBusy, setSnapBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [user, market, competitor, self] = await Promise.all([
        loadUserLook(userId, project.id),
        loadMarketLook(userId, project.id),
        loadCompetitorLook(userId, project.id),
        loadSelfAssessment(userId, project.id),
      ]);
      const evList = await loadEvidence(userId, project.id);
      const missing: string[] = [];
      if (!market.attractiveness.trim()) missing.push('看市场：缺吸引力判断');
      if (!user.targetUser.trim() && user.unmetNeedCandidates.length === 0) missing.push('看用户：缺用户与需求地图');
      if (!competitor.barriers.trim() && competitor.gaps.length === 0) missing.push('看竞对：缺壁垒与缺口');
      if (!self.aiDraft?.conclusion && !self.items.some((i) => i.status !== 'unknown')) missing.push('看自己：未做自评');
      setDraft({
        unmetCount: user.unmetNeedCandidates.length,
        unmetTop: user.unmetNeedCandidates.slice(0, 3).map((c) => c.needStatement || '(未填写)'),
        missing,
        evidenceTotal: evList.length,
        evidenceByLook: countEvidenceByLook(evList) as unknown as Record<string, number>,
        evidenceTop: evList.slice(0, 3).map((e) => describeEvidence(e)),
      });
    } catch {
      setDraft(null);
    }
  }, [userId, project.id]);

  const refreshSnapshot = useCallback(async () => {
    const raw = await loadSnapshot(userId, project.id);
    setSnap(raw ? { raw, summary: snapshotSummary(raw), text: describeSnapshot(raw) } : null);
  }, [userId, project.id]);

  useEffect(() => {
    void refresh();
    void refreshSnapshot();
  }, [refresh, refreshSnapshot, project.updatedAt, refreshKey]);

  const captureNow = async () => {
    setSnapBusy(true);
    try {
      const raw = await captureAndSaveSnapshot(userId, project.id);
      setSnap({ raw, summary: snapshotSummary(raw), text: describeSnapshot(raw) });
      await refresh();
    } finally {
      setSnapBusy(false);
    }
  };

  // 「推进到哪一步」：按五看顺序找第一个未完成的看
  const lookOrder: FiveLookId[] = ['user', 'market', 'competitor', 'self', 'opportunity'];
  const doneOf = (look: FiveLookId) => project.fiveLookProgress[look]?.status === 'completed';
  const firstOpen = lookOrder.find((l) => !doneOf(l)) ?? null;
  const allFourDone = (['user', 'market', 'competitor', 'self'] as FiveLookId[]).every(doneOf);

  return (
    <div className="rounded-2xl border border-black/8 bg-[#f8f9fb] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-indigo-500" />
        <p className="text-sm font-bold text-[#1d1d1f]">决策草稿</p>
        <span className="text-[10px] text-[#86868b]">全程跟随 · 随证据变化</span>
      </div>

      {/* ① 进度与下一步（线框图：已完成 ✓ / 下一步 → 可点） */}
      <div className="rounded-xl border border-black/8 bg-white p-3">
        <p className="text-[11px] font-semibold text-[#424245] mb-1.5">已完成与下一步</p>
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
          {lookOrder.map((l) => (
            <span
              key={l}
              className={cn(
                'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                doneOf(l) ? 'bg-emerald-50 text-emerald-700' : 'bg-[#f5f5f7] text-[#86868b]'
              )}
            >
              {doneOf(l) ? '✓ ' : ''}
              {FIVE_LOOK_LABELS[l]}
            </span>
          ))}
        </div>
        {firstOpen ? (
          <button
            type="button"
            onClick={() => onGoto?.(firstOpen)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900"
          >
            下一步：{allFourDone ? '确认机会卡与控制点' : FIVE_LOOK_LABELS[firstOpen]}
            <ChevronRight className="w-3 h-3" />
          </button>
        ) : (
          <p className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
            <CheckCircle2 className="w-3 h-3" /> 五看已完成，去「看机会」出结论
          </p>
        )}
      </div>

      {/* ② 未满足需求候选 */}
      <div>
        <p className="text-[11px] font-semibold text-[#424245] mb-1.5">未满足需求候选：{draft?.unmetCount ?? 0} 条</p>
        {draft && draft.unmetTop.length > 0 ? (
          <ul className="space-y-1">
            {draft.unmetTop.map((t, i) => (
              <li key={i} className="text-[11px] text-[#424245] leading-relaxed">
                · {t}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-[#86868b]">还没有需求候选 —— 先跑「看用户」。</p>
        )}
      </div>

      {/* ③ 还缺什么 */}
      <div>
        <p className="text-[11px] font-semibold text-[#424245] mb-1.5">还缺什么</p>
        {draft && draft.missing.length > 0 ? (
          <ul className="space-y-1">
            {draft.missing.map((m, i) => (
              <li key={i} className="text-[11px] text-amber-700 leading-relaxed">
                <AlertTriangle className="inline w-3 h-3 mr-0.5" />
                {m}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-emerald-700">五看证据已齐，可以进入「看机会」做结论。</p>
        )}
      </div>

      {/* ④ 项目证据 */}
      <div>
        <p className="text-[11px] font-semibold text-[#424245] mb-1.5">项目证据：{draft?.evidenceTotal ?? 0} 条</p>
        {draft && draft.evidenceTotal > 0 ? (
          <>
            <p className="text-[10px] text-[#86868b] mb-1">
              {(['user', 'market', 'competitor', 'self'] as const)
                .map((k) => `${EVIDENCE_LOOK_LABELS[k]} ${draft.evidenceByLook[k] ?? 0}`)
                .join(' · ')}
            </p>
            <ul className="space-y-1">
              {draft.evidenceTop.map((t, i) => (
                <li key={i} className="text-[10px] text-[#424245] leading-relaxed">
                  · {t}
                </li>
              ))}
            </ul>
            {draft.evidenceTotal > draft.evidenceTop.length && (
              <p className="text-[10px] text-[#aeaeb2] mt-1">还有 {draft.evidenceTotal - draft.evidenceTop.length} 条…</p>
            )}
          </>
        ) : (
          <p className="text-[10px] text-[#86868b]">还没有证据 —— 在各看页面点「捕获为项目证据」即可入库。</p>
        )}
      </div>

      {/* ⑤ 项目数据快照 */}
      <div className="rounded-xl border border-black/8 bg-white p-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <p className="text-[11px] font-semibold text-[#424245] inline-flex items-center gap-1">
            <Layers className="w-3 h-3" /> 项目数据快照
          </p>
          <button
            type="button"
            onClick={() => void captureNow()}
            disabled={snapBusy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
          >
            {snapBusy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {snap && hasSnapshotContent(snap.raw) ? '更新快照' : '捕获快照'}
          </button>
        </div>
        {snap && hasSnapshotContent(snap.raw) ? (
          <p className="text-[10px] text-[#86868b] leading-relaxed">
            {snap.text}
            <br />
            捕获于 {new Date(snap.summary.capturedAt).toLocaleString()}
          </p>
        ) : (
          <p className="text-[10px] text-amber-700 leading-relaxed">
            尚未捕获（或快照是空的）：AI 会回退读取全局工作区数据，可能混入其他项目。建议先「捕获快照」。
          </p>
        )}
      </div>

      <p className="text-[10px] text-[#86868b] leading-relaxed pt-1 border-t border-black/5">
        这里只显示当前证据状态，**不编造机会**；机会结论（先做/后做 · 前置资源 · 控制点）在「看机会」生成。
      </p>
    </div>
  );
}

/** 供向导复用：把失败分类翻成人话（草稿里不直接显示，避免两处重复逻辑） */
export function describeFailKind(kind: LookAiFailKind | null): string {
  if (kind === 'no-key') return '缺模型 Key';
  if (kind === 'no-data') return '缺数据';
  if (kind === 'parse') return 'AI 返回无法解析';
  return '';
}
