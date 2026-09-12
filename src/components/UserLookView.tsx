import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Users,
  Database,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  MessageCircle,
  Search,
} from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  loadUserLook,
  saveUserLook,
  makeUserEvidence,
  computeUserProgress,
  emptyUnmetNeedCandidate,
  EVIDENCE_STRENGTH_LABELS,
  SEARCH_PATH_LAYER_LABELS,
  SEARCH_PATH_LAYER_HINTS,
  PRICE_SENSITIVITY_LABELS,
  computeNeedEvidenceStrength,
  type UserContext,
  type UserEvidence,
  type UserLookData,
  type UnmetNeedCandidate,
  type EvidenceStrength,
} from '../utils/userLook';
import { updateLookProgress } from '../utils/projectStore';
import type { ResearchProject } from '../types/researchProject';
import { LookAiBar } from './LookAiBar';
import { mergeUserLookAi } from '../utils/lookAiApply';
import { addEvidence } from '../utils/evidence';
import { loadMarketLook } from '../utils/marketLook';
import { OpenQuestionAnswersCard } from './OpenQuestionAnswersCard';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const STRENGTHS: EvidenceStrength[] = ['high', 'medium', 'low'];

export function UserLookView({
  userId,
  project,
  userContext,
  onProjectChange,
}: {
  userId: string;
  project: ResearchProject;
  userContext: UserContext;
  onProjectChange: (updated: ResearchProject) => void;
}) {
  const [data, setData] = useState<UserLookData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  /** M2⑤：看市场提出的待验证问题（断链 #7 的下游消费者） */
  const [marketQuestions, setMarketQuestions] = useState<string[]>([]);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadMarketLook(userId, project.id).then((m) => {
      if (!cancelled) setMarketQuestions(m.openQuestions.filter((q) => q.trim().length > 0));
    });
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  useEffect(() => {
    let cancelled = false;
    void loadUserLook(userId, project.id).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  const persist = useCallback(
    async (d: UserLookData) => {
      setSaveState('saving');
      try {
        await saveUserLook(userId, project.id, d);
        const progress = computeUserProgress(d);
        const updated = await updateLookProgress(userId, project.id, 'user', {
          ...project.fiveLookProgress.user,
          status: progress.status,
          completionPercent: progress.completionPercent,
          missingRequirements: progress.missingRequirements,
          updatedAt: new Date().toISOString(),
        });
        if (updated) onProjectChange(updated);
        setSaveState('saved');
      } catch {
        setSaveState('error');
      }
    },
    [userId, project.id, project.fiveLookProgress, onProjectChange]
  );

  const scheduleSave = useCallback(
    (next: UserLookData) => {
      setData(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persist(next);
      }, 500);
    },
    [persist]
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载…
      </div>
    );
  }

  const update = (patch: Partial<UserLookData>) => scheduleSave({ ...data, ...patch });

  const updateCandidate = (id: string, patch: Partial<UnmetNeedCandidate>) => {
    update({ unmetNeedCandidates: data.unmetNeedCandidates.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  const addCandidate = () => update({ unmetNeedCandidates: [...data.unmetNeedCandidates, emptyUnmetNeedCandidate()] });
  const removeCandidate = (id: string) => update({ unmetNeedCandidates: data.unmetNeedCandidates.filter((c) => c.id !== id) });

  const updateList = (key: 'satisfiedNeeds', index: number, value: string) => {
    const next = [...data[key]];
    next[index] = value;
    update({ [key]: next } as Partial<UserLookData>);
  };
  const addList = (key: 'satisfiedNeeds') => update({ [key]: [...data[key], ''] } as Partial<UserLookData>);
  const removeList = (key: 'satisfiedNeeds', index: number) => update({ [key]: data[key].filter((_, i) => i !== index) } as Partial<UserLookData>);

  const captureEvidence = () => {
    update({ evidence: makeUserEvidence(userContext) });
    // M1：同时写入结构化 Evidence（断链 #5：证据可追溯，而不是只有元数据）
    void addEvidence(userId, project.id, {
      look: 'user',
      type: 'review',
      sourceRef: `user:${userContext.sourceLabel || 'workspace'}@${new Date().toISOString().slice(0, 10)}`,
      summary: `关键词 ${userContext.keywordsCount} 个 + 评论 ${userContext.reviewsCount} 条${
        userContext.sourceLabel ? ` · ${userContext.sourceLabel}` : ''
      }`,
    });
  };

  /** M1：AI 起草回填（只填空字段，不覆盖人工已填内容；逻辑与一键向导共用） */
  const applyAi = (out: Record<string, unknown>) => {
    const { next, filled, skipped } = mergeUserLookAi(data, out);
    update(next);
    return { filled, skipped };
  };

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#1d1d1f]">看用户 · 需求地图</h3>
            <p className="text-sm text-[#86868b] mt-0.5 max-w-xl">
              把关键词与评论 VOC 合并为「谁在什么场景完成什么任务」，识别未被充分满足的需求。
            </p>
          </div>
        </div>
        <SaveBadge state={saveState} />
      </div>

      <LookAiBar
        look="user"
        userId={userId}
        projectId={project.id}
        onApply={applyAi}
        hint="已经加载了关键词与评论数据时，AI 会把它们合并成需求地图（目标用户 / 场景 / JTBD / 已满足 / 未满足候选），并吸收市场细分里的人群·场景·需求描述。"
      />

      {/* M2⑤ 修断链 #7：看市场留下的待验证问题，在本步就地回答 */}
      <OpenQuestionAnswersCard
        questions={marketQuestions}
        answers={data.openQuestionAnswers}
        onChange={(next) => update({ openQuestionAnswers: next })}
        hint="这些问题由「看市场」提出、需要在这一步用关键词与 VOC 证据验证；答不出来就留空，不要编。"
        inputCls={inputCls}
      />

      {/* M2：搜索路径图 + 搜索偏好卡（结论先行的第一屏） */}
      {(data.searchPath || data.searchPreference) && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
          <Card>
            <div className="p-5">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-sm font-semibold text-[#1d1d1f]">搜索路径图</p>
                <span className="text-[11px] text-[#86868b]">认知 → 考虑 → 决策 → 场景</span>
              </div>
              {data.searchPath?.summary && (
                <p className="text-xs text-[#424245] mb-3 leading-relaxed">{data.searchPath.summary}</p>
              )}
              <div className="space-y-3">
                {(data.searchPath?.layers ?? []).map((layer) => (
                  <div key={layer.layer} className="rounded-xl border border-black/5 bg-[#f8f9fb] p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-[#1d1d1f]">{SEARCH_PATH_LAYER_LABELS[layer.layer]}</span>
                      <span className="text-[10px] text-[#86868b]">{SEARCH_PATH_LAYER_HINTS[layer.layer]}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {layer.words.map((w) => (
                        <span
                          key={`${layer.layer}-${w.word}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-black/8 text-[11px] text-[#424245]"
                        >
                          {w.word}
                          {w.share !== undefined && <span className="text-[#aeaeb2]">{Math.round(w.share * 100)}%</span>}
                          {w.volume !== undefined && <span className="text-[#aeaeb2]">{w.volume.toLocaleString()}</span>}
                        </span>
                      ))}
                    </div>
                    {layer.note && <p className="text-[10px] text-[#86868b] mt-1.5 leading-relaxed">{layer.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-5 space-y-3">
              <p className="text-sm font-semibold text-[#1d1d1f]">搜索偏好</p>
              {data.searchPreference?.priceSensitivity && (
                <div>
                  <p className="text-[11px] text-[#86868b]">价格敏感度</p>
                  <p className="text-sm font-semibold text-[#1d1d1f]">
                    {PRICE_SENSITIVITY_LABELS[data.searchPreference.priceSensitivity]}
                  </p>
                  {data.searchPreference.priceSensitivityNote && (
                    <p className="text-[10px] text-[#86868b] mt-0.5">{data.searchPreference.priceSensitivityNote}</p>
                  )}
                </div>
              )}
              {data.searchPreference?.attributeMix && (
                <div>
                  <p className="text-[11px] text-[#86868b]">词性倾向</p>
                  <p className="text-xs text-[#424245] leading-relaxed">{data.searchPreference.attributeMix}</p>
                </div>
              )}
              {data.searchPreference?.longTailShare !== undefined && (
                <div>
                  <p className="text-[11px] text-[#86868b]">长尾结构</p>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 rounded-full bg-[#e5e5ea] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-500"
                        style={{ width: `${Math.round(data.searchPreference.longTailShare * 100)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-[#424245]">
                      长尾占 {Math.round(data.searchPreference.longTailShare * 100)}%
                    </span>
                  </div>
                </div>
              )}
              {data.searchPreference?.decisionFocus && data.searchPreference.decisionFocus.length > 0 && (
                <div>
                  <p className="text-[11px] text-[#86868b] mb-1">决策焦点（买家下单前对比什么）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.searchPreference.decisionFocus.map((f) => (
                      <span key={f} className="px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-100 text-[11px] text-indigo-700">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
      {/* 数据上下文 */}
      <Card>
        <div className="p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm font-semibold text-[#1d1d1f]">数据上下文</p>
            <button
              type="button"
              onClick={captureEvidence}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
            >
              <Database className="w-3.5 h-3.5" />
              {data.evidence ? '更新捕获证据' : '捕获为项目证据'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#86868b]">
            <span className="inline-flex items-center gap-1"><Search className="w-3.5 h-3.5" /> 关键词 {userContext.keywordsCount}</span>
            <span className="inline-flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" /> 评论 {userContext.reviewsCount}</span>
            <span>{userContext.sourceLabel || '未标注来源'}</span>
            {userContext.isDemo && <span className="rounded-full bg-indigo-50 text-indigo-600 px-2 py-0.5 text-[10px] font-semibold">示例数据</span>}
          </div>
        </div>
      </Card>

      {data.evidence && <UserEvidenceCard evidence={data.evidence} />}

      {/* 用户需求地图：目标用户 / 场景 / JTBD */}
      <Card>
        <div className="p-5 space-y-4">
          <p className="text-sm font-semibold text-[#1d1d1f]">用户需求地图</p>
          <Field label="目标用户">
            <input value={data.targetUser} onChange={(e) => update({ targetUser: e.target.value })} placeholder="例如：美国站侧睡人群、颈椎不适的上班族" className={inputCls} />
          </Field>
          <Field label="使用场景">
            <input value={data.scenario} onChange={(e) => update({ scenario: e.target.value })} placeholder="例如：睡前、久坐办公、旅行途中" className={inputCls} />
          </Field>
          <Field label="用户任务 / JTBD">
            <textarea value={data.jobToBeDone} onChange={(e) => update({ jobToBeDone: e.target.value })} rows={2} placeholder="用户希望完成什么任务？例如：侧睡时保持颈椎中立、不闷热" className={inputCls} />
          </Field>
        </div>
      </Card>

      {/* 已满足需求 */}
      <StringListCard title="已满足需求" hint="现有产品已经较好满足的需求，用于对照" value={data.satisfiedNeeds} onAdd={() => addList('satisfiedNeeds')} onChange={(i, v) => updateList('satisfiedNeeds', i, v)} onRemove={(i) => removeList('satisfiedNeeds', i)} />

      {/* 未满足需求候选 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-[#1d1d1f]">未满足需求候选</p>
            <p className="text-xs text-[#aeaeb2] mt-0.5">每个候选都要能说明：目标用户 + 场景 + 任务 + 当前替代方案 + 证据强度</p>
          </div>
          <button type="button" onClick={addCandidate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]">
            <Plus className="w-3.5 h-3.5" /> 添加未满足需求
          </button>
        </div>
        {data.unmetNeedCandidates.length === 0 ? (
          <Card className="py-10 text-center">
            <p className="text-sm text-[#aeaeb2]">尚未添加未满足需求候选</p>
          </Card>
        ) : (
          groupCandidatesByCategory(data.unmetNeedCandidates).map(([cat, list]) => (
            <div key={cat} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#1d1d1f]">{cat}</span>
                <span className="text-[10px] text-[#86868b]">{list.length} 条需求</span>
              </div>
              {list.map((c) => {
                const idx = data.unmetNeedCandidates.findIndex((x) => x.id === c.id);
                return (
                  <UnmetNeedCard
                    key={c.id}
                    index={idx}
                    candidate={c}
                    onChange={(patch) => updateCandidate(c.id, patch)}
                    onRemove={() => removeCandidate(c.id)}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function groupCandidatesByCategory(list: UnmetNeedCandidate[]): [string, UnmetNeedCandidate[]][] {
  const map = new Map<string, UnmetNeedCandidate[]>();
  for (const c of list) {
    const key = (c.category ?? '').trim() || '未分类需求';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(c);
  }
  return Array.from(map.entries());
}

function UnmetNeedCard({
  index,
  candidate,
  onChange,
  onRemove,
}: {
  index: number;
  candidate: UnmetNeedCandidate;
  onChange: (patch: Partial<UnmetNeedCandidate>) => void;
  onRemove: () => void;
}) {
  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-[#86868b]">未满足需求 #{index + 1}</span>
          <button type="button" onClick={onRemove} className="w-8 h-8 rounded-lg hover:bg-rose-50 flex items-center justify-center text-[#aeaeb2] hover:text-rose-500 transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <Field label="未满足需求">
          <textarea value={candidate.needStatement} onChange={(e) => onChange({ needStatement: e.target.value })} rows={2} placeholder="当前产品没有充分满足什么？" className={inputCls} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Field label="目标用户">
            <input value={candidate.targetUser} onChange={(e) => onChange({ targetUser: e.target.value })} placeholder="谁存在这个需求" className={inputCls} />
          </Field>
          <Field label="使用场景">
            <input value={candidate.scenario} onChange={(e) => onChange({ scenario: e.target.value })} placeholder="在什么情况下" className={inputCls} />
          </Field>
          <Field label="用户任务 / JTBD">
            <input value={candidate.jobToBeDone} onChange={(e) => onChange({ jobToBeDone: e.target.value })} placeholder="需要完成什么任务" className={inputCls} />
          </Field>
          <Field label="当前替代方案">
            <input value={candidate.currentAlternative} onChange={(e) => onChange({ currentAlternative: e.target.value })} placeholder="用户现在怎么解决，代价是什么" className={inputCls} />
          </Field>
        </div>
        <div className="mt-3">
          <p className="text-xs font-semibold text-[#424245] mb-1.5">证据强度</p>
          <div className="flex items-center gap-1.5">
            {STRENGTHS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ evidenceStrength: s })}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all active:scale-[0.96]',
                  candidate.evidenceStrength === s
                    ? s === 'high' ? 'bg-emerald-600 text-white border-emerald-600' : s === 'medium' ? 'bg-amber-500 text-white border-amber-500' : 'bg-rose-500 text-white border-rose-500'
                    : 'bg-white text-[#aeaeb2] border-black/5 hover:text-[#424245] hover:border-black/10'
                )}
              >
                {EVIDENCE_STRENGTH_LABELS[s]}
              </button>
            ))}
          </div>
        </div>

        {/* M2：需求分类 + 证据链 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Field label="需求域（用于市场细分）">
            <input
              value={candidate.category ?? ''}
              onChange={(e) => onChange({ category: e.target.value })}
              placeholder="如：功能需求 / 体感需求 / 维护需求"
              className={inputCls}
            />
          </Field>
          <Field label="子需求（可空）">
            <input
              value={candidate.subCategory ?? ''}
              onChange={(e) => onChange({ subCategory: e.target.value })}
              placeholder="更细的切分，如：高度可调"
              className={inputCls}
            />
          </Field>
        </div>

        {candidate.evidence ? (
          <div className="mt-3 rounded-xl border border-black/5 bg-[#f8f9fb] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#424245]">证据链</p>
              {(() => {
                const sc = computeNeedEvidenceStrength(candidate.evidence);
                const cls = sc.level === 'high' ? 'text-emerald-700' : sc.level === 'medium' ? 'text-amber-700' : 'text-rose-700';
                return (
                  <span className={`text-[10px] font-semibold ${cls}`} title={sc.reasons.join('；')}>
                    确定性证据分 {sc.score}/100（{EVIDENCE_STRENGTH_LABELS[sc.level]}）
                  </span>
                );
              })()}
            </div>
            {candidate.evidence.keywords && candidate.evidence.keywords.length > 0 && (
              <div>
                <p className="text-[10px] text-[#86868b] mb-1">关键词证据</p>
                <div className="flex flex-wrap gap-1.5">
                  {candidate.evidence.keywords.map((k) => (
                    <span key={k.word} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-black/8 text-[11px] text-[#424245]">
                      {k.word}
                      {k.volume !== undefined && <span className="text-[#aeaeb2]">{k.volume.toLocaleString()}</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {candidate.evidence.reviewQuotes && candidate.evidence.reviewQuotes.length > 0 && (
              <div>
                <p className="text-[10px] text-[#86868b] mb-1">评论原文</p>
                <ul className="space-y-1">
                  {candidate.evidence.reviewQuotes.map((q, qi) => (
                    <li key={qi} className="text-[11px] text-[#424245] leading-relaxed">
                      “{q.quote}”
                      {q.asin && <span className="text-[#aeaeb2]"> — {q.asin}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {candidate.evidence.asins && candidate.evidence.asins.length > 0 && (
              <div>
                <p className="text-[10px] text-[#86868b] mb-1">覆盖 ASIN（{candidate.evidence.asins.length}）</p>
                <div className="flex flex-wrap gap-1.5">
                  {candidate.evidence.asins.map((a) => (
                    <span key={a} className="px-2 py-0.5 rounded-lg bg-white border border-black/8 text-[11px] text-[#424245] font-mono">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-[#aeaeb2] mt-3">
            暂无结构化证据 —— 点上方「AI 生成 / 重跑这一步」，或手动把关键词/评论原文补进来（补了之后系统会按确定性公式算证据分）。
          </p>
        )}
      </div>
    </Card>
  );
}

function StringListCard({
  title,
  hint,
  value,
  onAdd,
  onChange,
  onRemove,
}: {
  title: string;
  hint: string;
  value: string[];
  onAdd: () => void;
  onChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <Card>
      <div className="p-5">
        <p className="text-sm font-semibold text-[#1d1d1f] mb-1">{title}</p>
        <p className="text-xs text-[#aeaeb2] mb-3">{hint}</p>
        <div className="space-y-2">
          {value.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input value={v} onChange={(e) => onChange(i, e.target.value)} placeholder={`第 ${i + 1} 条`} className={inputCls} />
              <button type="button" onClick={() => onRemove(i)} className="shrink-0 w-8 h-8 rounded-lg hover:bg-[#f5f5f7] flex items-center justify-center text-[#aeaeb2] hover:text-rose-500 transition-colors"><X className="w-4 h-4" /></button>
            </div>
          ))}
          <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
            <Plus className="w-3.5 h-3.5" /> 添加
          </button>
        </div>
      </div>
    </Card>
  );
}

function UserEvidenceCard({ evidence }: { evidence: UserEvidence }) {
  return (
    <Card className="border-indigo-100 bg-indigo-50/40">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-4 h-4 text-indigo-600" />
          <p className="text-sm font-semibold text-[#1d1d1f]">已捕获的用户证据</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#86868b]">
          <span>关键词 {evidence.keywordsCount}</span>
          <span>评论 {evidence.reviewsCount}</span>
          <span>{evidence.sourceLabel || '未标注来源'}</span>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-[#424245] mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  const map: Record<SaveState, { icon: typeof CheckCircle2; text: string; cls: string }> = {
    idle: { icon: CheckCircle2, text: '', cls: '' },
    saving: { icon: Loader2, text: '保存中…', cls: 'text-amber-600' },
    saved: { icon: CheckCircle2, text: '已保存', cls: 'text-emerald-600' },
    error: { icon: AlertTriangle, text: '保存失败', cls: 'text-rose-600' },
  };
  const m = map[state];
  const Icon = m.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', m.cls)}>
      <Icon className={cn('w-3.5 h-3.5', state === 'saving' && 'animate-spin')} />
      {m.text}
    </span>
  );
}

const inputCls =
  'w-full px-3 py-2.5 rounded-xl border border-black/8 bg-gradient-to-b from-white to-[#f8f9fb] text-sm text-[#1d1d1f] placeholder:text-[#aeaeb2] focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-300 transition-all';
