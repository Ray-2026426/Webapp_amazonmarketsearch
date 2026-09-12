import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Play, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { runLookAnalysis } from '../utils/lookAi';
import {
  mergeUserLookAi,
  mergeMarketLookAi,
  mergeCompetitorLookAi,
  mergeSelfAi,
  buildSelfAnswers,
} from '../utils/lookAiApply';
import { loadUserLook, saveUserLook, computeUserProgress, type UserLookData } from '../utils/userLook';
import { loadMarketLook, saveMarketLook, computeMarketProgress } from '../utils/marketLook';
import { loadCompetitorLook, saveCompetitorLook, computeCompetitorProgress } from '../utils/competitorLook';
import {
  loadSelfAssessment,
  saveSelfAssessment,
  computeSelfProgress,
  SELF_CATEGORY_LABELS,
  SELF_STATUS_LABELS,
} from '../utils/selfAssessment';
import { updateLookProgress } from '../utils/projectStore';
import {
  captureAndSaveSnapshot,
  captureSnapshot,
  saveSnapshot,
  loadSnapshot,
  snapshotSummary,
  describeSnapshot,
  hasSnapshotContent,
  type ProjectSnapshot,
  type SnapshotSummary,
} from '../utils/projectSnapshot';
import { loadEvidence, countEvidenceByLook, describeEvidence, EVIDENCE_LOOK_LABELS } from '../utils/evidence';
import { FIVE_LOOK_LABELS, type ResearchProject } from '../types/researchProject';

/**
 * M1：一键向导 + 决策草稿（PRD §5.2-5 触发模型 / §5.2-3 决策草稿）。
 *
 * 触发模型：用户点一次「开始分析」，系统按 看用户 → 看市场 → 看竞对 → 看自己 顺序自动跑，
 * 每一步都用 lookAiMerge 的非破坏性规则回填（**只填空字段、绝不覆盖人工内容**），
 * 并把每一步的结果（新增了什么 / 跳过了什么 / 失败原因）摊开给用户核对。
 *
 * 放在「概览」页：这样运行期间没有任何看视图挂载，避免组件内存态与向导写入互相覆盖；
 * 跑完后用户依次点开各看 Tab 即可看到结果（各视图在挂载时会重新从存储读取）。
 */

type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'failed';

/** AI 只跑前四看；「看机会」由用户拍板，不由向导代跑 */
type AiLookId = 'user' | 'market' | 'competitor' | 'self';

interface WizardStep {
  look: AiLookId;
  status: StepStatus;
  message: string;
}

const ORDER: AiLookId[] = ['user', 'market', 'competitor', 'self'];

function initialSteps(): WizardStep[] {
  return ORDER.map((look) => ({ look, status: 'pending' as StepStatus, message: '' }));
}

const STEP_STATUS_STYLE: Record<StepStatus, { text: string; icon: typeof CircleDashed; cls: string }> = {
  pending: { text: '待运行', icon: CircleDashed, cls: 'text-[#c7c7cc]' },
  running: { text: '分析中…', icon: Loader2, cls: 'text-indigo-600' },
  done: { text: '已完成', icon: CheckCircle2, cls: 'text-emerald-600' },
  skipped: { text: '已跳过', icon: AlertTriangle, cls: 'text-amber-600' },
  failed: { text: '失败', icon: AlertTriangle, cls: 'text-rose-600' },
};

export function LookWizardPanel({
  userId,
  project,
  onProjectChange,
  onLoadDemo,
  onOpenTool,
}: {
  userId: string;
  project: ResearchProject;
  onProjectChange: (updated: ResearchProject) => void;
  /** 「加载示例数据」——缺失数据时的一键兜底 */
  onLoadDemo?: () => void;
  /** 打开对应工具去补数据 */
  onOpenTool?: (view: 'market' | 'keywords' | 'insights' | 'competitors') => void;
}) {
  const [steps, setSteps] = useState<WizardStep[]>(initialSteps);
  const [running, setRunning] = useState(false);
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
  const snapHasContent = snap ? hasSnapshotContent(snap.raw) : false;
  const [showDataHelp, setShowDataHelp] = useState(false);

  /** 决策草稿：只反映"当前证据状态"，不编造机会（机会结论由看机会负责） */
  const refreshDraft = useCallback(async () => {
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
        evidenceTop: evList.slice(0, 4).map((e) => describeEvidence(e)),
      });
    } catch {
      setDraft(null);
    }
  }, [userId, project.id]);

  useEffect(() => {
    void refreshDraft();
  }, [refreshDraft, project.updatedAt]);

  const refreshSnapshot = useCallback(async () => {
    const raw = await loadSnapshot(userId, project.id);
    setSnap(raw ? { raw, summary: snapshotSummary(raw), text: describeSnapshot(raw) } : null);
  }, [userId, project.id]);

  useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  /** 捕获/更新本项目数据快照：AI 与细分评分从此只认这份数据，不再跨项目污染 */
  const captureNow = async () => {
    setSnapBusy(true);
    try {
      const raw = await captureAndSaveSnapshot(userId, project.id);
      setSnap({ raw, summary: snapshotSummary(raw), text: describeSnapshot(raw) });
      if (hasSnapshotContent(raw)) {
        toast.success('已捕获本项目数据快照');
      } else {
        toast.warning('当前工作区还没有数据，这份快照是空的：请先加载数据再更新快照');
      }
    } catch (e) {
      toast.error(`捕获失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSnapBusy(false);
    }
  };

  const patchStep = (look: AiLookId, patch: Partial<WizardStep>) => {
    setSteps((prev) => prev.map((s) => (s.look === look ? { ...s, ...patch } : s)));
  };

  /** 跑完一个看：读取 → 非破坏性合并 → 保存 → 更新进度 */
  const applyLook = async (look: AiLookId, out: Record<string, unknown>): Promise<string> => {
    if (look === 'user') {
      const cur: UserLookData = await loadUserLook(userId, project.id);
      const { next, filled, skipped } = mergeUserLookAi(cur, out);
      await saveUserLook(userId, project.id, next);
      const p = computeUserProgress(next);
      const updated = await updateLookProgress(userId, project.id, 'user', {
        ...project.fiveLookProgress.user,
        ...p,
        updatedAt: new Date().toISOString(),
      });
      if (updated) onProjectChange(updated);
      return summarize(filled, skipped);
    }
    if (look === 'market') {
      const cur = await loadMarketLook(userId, project.id);
      const { next, filled, skipped } = mergeMarketLookAi(cur, out);
      await saveMarketLook(userId, project.id, next);
      const p = computeMarketProgress(next);
      const updated = await updateLookProgress(userId, project.id, 'market', {
        ...project.fiveLookProgress.market,
        ...p,
        updatedAt: new Date().toISOString(),
      });
      if (updated) onProjectChange(updated);
      return summarize(filled, skipped);
    }
    if (look === 'competitor') {
      const cur = await loadCompetitorLook(userId, project.id);
      const { next, filled, skipped } = mergeCompetitorLookAi(cur, out);
      await saveCompetitorLook(userId, project.id, next);
      const p = computeCompetitorProgress(next);
      const updated = await updateLookProgress(userId, project.id, 'competitor', {
        ...project.fiveLookProgress.competitor,
        ...p,
        updatedAt: new Date().toISOString(),
      });
      if (updated) onProjectChange(updated);
      return summarize(filled, skipped);
    }
    const cur = await loadSelfAssessment(userId, project.id);
    const { next, filled, skipped } = mergeSelfAi(cur, out);
    await saveSelfAssessment(userId, project.id, next);
    const p = computeSelfProgress(next);
    const updated = await updateLookProgress(userId, project.id, 'self', {
      ...project.fiveLookProgress.self,
      ...p,
      updatedAt: new Date().toISOString(),
    });
    if (updated) onProjectChange(updated);
    return summarize(filled, skipped);
  };

  const run = async () => {
    setRunning(true);
    setSteps(initialSteps());
    // 确保有一份"有内容"的快照：空快照会被重新捕获
    // （否则 AI 会永久读到空数据 → 四步永远显示"已跳过"，这是 M1 引入的一个真 bug，此处修掉）
    try {
      if (!snap || !hasSnapshotContent(snap.raw)) {
        const raw = await captureSnapshot(userId, project.id);
        if (hasSnapshotContent(raw)) {
          await saveSnapshot(userId, project.id, raw);
          setSnap({ raw, summary: snapshotSummary(raw), text: describeSnapshot(raw) });
          toast.info('已自动捕获本项目数据快照：本次分析只使用这份数据');
        } else {
          setSnap(null);
        }
      }
    } catch {
      /* 捕获失败则走回退路径，runLookAnalysis 会在 scopeNote 里明确告知 */
    }
    let doneCount = 0;
    let failCount = 0;
    for (const look of ORDER) {
      patchStep(look, { status: 'running', message: '' });
      try {
        let extra: Record<string, unknown> | undefined;
        if (look === 'self') {
          const sa = await loadSelfAssessment(userId, project.id);
          extra = { answers: buildSelfAnswers(sa, SELF_CATEGORY_LABELS, SELF_STATUS_LABELS) };
        }
        const res = await runLookAnalysis(look, { ...(extra ?? {}), scope: { userId, projectId: project.id } });
        if (!res.ok || !res.data) {
          const msg = res.error || 'AI 分析失败';
          // 数据缺失属于"跳过"而非"失败"，便于用户区分
          const isSkipped = /尚未|请先/.test(msg);
          patchStep(look, { status: isSkipped ? 'skipped' : 'failed', message: msg });
          if (isSkipped) doneCount += 0;
          else failCount += 1;
          continue;
        }
        const summary = await applyLook(look, res.data);
        patchStep(look, { status: 'done', message: summary });
        doneCount += 1;
      } catch (e) {
        failCount += 1;
        patchStep(look, { status: 'failed', message: e instanceof Error ? e.message : '执行失败' });
      }
    }
    setRunning(false);
    await refreshDraft();
    await refreshSnapshot();
    if (doneCount === 0) setShowDataHelp(true);
    if (doneCount === 0 && failCount === 0) {
      toast.info('四步都被跳过：请先到「市场大盘 / 关键词 / 评论 VOC / 竞品」加载数据后重试。');
    } else if (failCount > 0) {
      toast.warning(`一键分析结束：成功 ${doneCount} 步，失败 ${failCount} 步，请查看每步原因。`);
    } else {
      toast.success(`一键分析完成（${doneCount} 步），请逐个 Tab 核对结论。`);
    }
  };

  const finished = steps.some((s) => s.status !== 'pending');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
      {/* 向导主体 */}
      <div className="rounded-2xl border border-indigo-100 bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-black/5 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#1d1d1f]">一键分析 · 五看向导</p>
              <p className="text-xs text-[#86868b] mt-0.5">
                按「看用户 → 看市场 → 看竞对 → 看自己」自动跑一遍，每步只填空字段、不覆盖你已填的内容
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void run()}
            disabled={running}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : finished ? <RefreshCw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {running ? '正在分析…' : finished ? '重新跑一遍' : '开始分析'}
          </button>
        </div>

        <div className="divide-y divide-black/5">
          {steps.map((s, i) => {
            const st = STEP_STATUS_STYLE[s.status];
            const Icon = st.icon;
            const progress = project.fiveLookProgress[s.look];
            return (
              <div key={s.look} className="px-5 py-3 flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-[#f5f5f7] flex items-center justify-center text-[11px] font-bold text-[#86868b] shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-[#1d1d1f]">{FIVE_LOOK_LABELS[s.look]}</span>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${st.cls}`}>
                      <Icon className={`w-3 h-3 ${s.status === 'running' ? 'animate-spin' : ''}`} />
                      {st.text}
                    </span>
                    <span className="text-[11px] text-[#aeaeb2]">
                      进度 {progress.completionPercent}%
                    </span>
                  </div>
                  {s.message && <p className="text-[11px] text-[#424245] mt-1 leading-relaxed">{s.message}</p>}
                </div>
              </div>
            );
          })}
        </div>

        {(showDataHelp || !snapHasContent) && (
          <div className="px-5 py-4 bg-amber-50 border-t border-amber-100">
            <p className="text-xs font-bold text-[#1d1d1f] mb-1">需要先准备数据（任选其一，30 秒可完成）</p>
            <p className="text-[11px] text-[#424245] leading-relaxed mb-2.5">
              四步都读同一份「项目数据快照」。没有 商品表 / 关键词 / 评论 / 竞品 ASIN 时，AI 给不出结论——
              <b>系统不会伪造结论</b>，所以会标成「已跳过」并说明原因。
            </p>
            <div className="flex flex-wrap gap-2">
              {onLoadDemo && (
                <button
                  type="button"
                  onClick={onLoadDemo}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  加载示例数据（最快，立刻体验全流程）
                </button>
              )}
              {onOpenTool && (
                <>
                  <button type="button" onClick={() => onOpenTool('market')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/10 bg-white text-[11px] font-semibold text-[#424245] hover:border-indigo-300 hover:text-indigo-700">
                    打开市场大盘（上传 Excel / 抓数）
                  </button>
                  <button type="button" onClick={() => onOpenTool('keywords')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/10 bg-white text-[11px] font-semibold text-[#424245] hover:border-indigo-300 hover:text-indigo-700">
                    打开关键词工具
                  </button>
                  <button type="button" onClick={() => onOpenTool('insights')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/10 bg-white text-[11px] font-semibold text-[#424245] hover:border-indigo-300 hover:text-indigo-700">
                    打开评论 VOC 工具
                  </button>
                  <button type="button" onClick={() => onOpenTool('competitors')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/10 bg-white text-[11px] font-semibold text-[#424245] hover:border-indigo-300 hover:text-indigo-700">
                    打开竞品工具
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {!finished && !showDataHelp && snapHasContent && (
          <div className="px-5 py-3 bg-[#f8f9fb] border-t border-black/5">
            <p className="text-[11px] text-[#86868b] leading-relaxed">
              数据已就绪。AI 结论需在「设置 → API 与模型」配置模型 Key；任何一步缺少数据都会被标为「已跳过」并说明原因，不会伪造结论。
            </p>
          </div>
        )}
      </div>

      {/* 决策草稿 */}
      <div className="rounded-2xl border border-black/8 bg-[#f8f9fb] p-4 space-y-3 self-start">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-500" />
          <p className="text-sm font-bold text-[#1d1d1f]">决策草稿</p>
          <span className="text-[10px] text-[#86868b]">随证据变化</span>
        </div>

        {/* 项目数据快照（M1 · 修跨项目污染） */}
        <div className="rounded-xl border border-black/8 bg-white p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-[11px] font-semibold text-[#424245]">项目数据快照</p>
            <button
              type="button"
              onClick={() => void captureNow()}
              disabled={snapBusy}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-indigo-200 bg-indigo-50 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            >
              {snapBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {snap ? '更新快照' : '捕获快照'}
            </button>
          </div>
          {snap ? (
            <p className="text-[10px] text-[#86868b] leading-relaxed">
              {snap.text}
              <br />
              捕获于 {new Date(snap.summary.capturedAt).toLocaleString()}
            </p>
          ) : (
            <p className="text-[10px] text-amber-700 leading-relaxed">
              尚未捕获：AI 会回退读取全局工作区数据（可能混入其他项目）。建议先点「捕获快照」，再跑一键分析。
            </p>
          )}
        </div>
        {draft ? (
          <>
            <div>
              <p className="text-[11px] font-semibold text-[#424245] mb-1.5">
                未满足需求候选：{draft.unmetCount} 条
              </p>
              {draft.unmetTop.length > 0 ? (
                <ul className="space-y-1">
                  {draft.unmetTop.map((t, i) => (
                    <li key={i} className="text-[11px] text-[#424245] leading-relaxed">· {t}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-[#86868b]">还没有需求候选 —— 先跑「看用户」。</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#424245] mb-1.5">还缺什么</p>
              {draft.missing.length > 0 ? (
                <ul className="space-y-1">
                  {draft.missing.map((m, i) => (
                    <li key={i} className="text-[11px] text-amber-700 leading-relaxed">· {m}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-emerald-700">五看证据已齐，可以进入「看机会」做结论。</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-[#424245] mb-1.5">
                项目证据：{draft.evidenceTotal} 条
              </p>
              {draft.evidenceTotal > 0 ? (
                <>
                  <p className="text-[10px] text-[#86868b] mb-1">
                    {(['user', 'market', 'competitor', 'self'] as const)
                      .map((k) => `${EVIDENCE_LOOK_LABELS[k]} ${draft.evidenceByLook[k] ?? 0}`)
                      .join(' · ')}
                  </p>
                  <ul className="space-y-1">
                    {draft.evidenceTop.map((t, i) => (
                      <li key={i} className="text-[10px] text-[#424245] leading-relaxed">· {t}</li>
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
            <p className="text-[10px] text-[#86868b] leading-relaxed pt-1 border-t border-black/5">
              这里只显示当前证据状态，不编造机会；机会结论（含先做/后做/前置资源/控制点）在「看机会」生成。
            </p>
          </>
        ) : (
          <p className="text-[11px] text-[#86868b]">正在读取项目证据…</p>
        )}
      </div>
    </div>
  );
}

function summarize(filled: string[], skipped: string[]): string {
  if (filled.length === 0) {
    return skipped.length
      ? `AI 已完成分析，但你已填写的字段全部保留（未覆盖）：${skipped.slice(0, 3).join('、')}${skipped.length > 3 ? '…' : ''}`
      : 'AI 已完成分析，但没有可回填的新内容。';
  }
  const f = `AI 已起草：${filled.join('、')}`;
  const s = skipped.length ? `；保留你已填的：${skipped.slice(0, 3).join('、')}${skipped.length > 3 ? '…' : ''}` : '';
  return f + s;
}
