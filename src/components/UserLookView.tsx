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
  Layers,
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
  SEARCH_PATH_LAYER_ORDER,
  PRICE_SENSITIVITY_LABELS,
  computeNeedEvidenceStrength,
  computeSearchPathFlow,
  describeSearchPathFlow,
  type UserContext,
  type UserEvidence,
  type UserLookData,
  type SegmentStandard,
  type UnmetNeedCandidate,
  type EvidenceStrength,
  type SearchPath,
  type SearchPathFlow,
  type SearchPathLayerId,
  type SearchPreference,
} from '../utils/userLook';
import { updateLookProgress } from '../utils/projectStore';
import type { ResearchProject } from '../types/researchProject';
import { LookAiBar } from './LookAiBar';
import { mergeUserLookAi } from '../utils/lookAiApply';
import { addEvidence } from '../utils/evidence';
import { loadMarketLook } from '../utils/marketLook';
import { OpenQuestionAnswersCard } from './OpenQuestionAnswersCard';
import type { L3Id } from '../utils/l3Pages';
import type { L3BlockVariant, L3BodyRender } from './L3Sheet';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const STRENGTHS: EvidenceStrength[] = ['high', 'medium', 'low'];

export function UserLookView({
  userId,
  project,
  userContext,
  onProjectChange,
  onOpenL3,
  onRegisterL3Bodies,
}: {
  userId: string;
  project: ResearchProject;
  userContext: UserContext;
  onProjectChange: (updated: ResearchProject) => void;
  /** 线框图 ⏳3：打开二级页①搜索路径②搜索偏好③需求分类树④细分标准 */
  onOpenL3?: (id: L3Id) => void;
  /** 线框图 ⏳3：把 ①②③④ 的正文（与内联同一份实现）注册给全屏页壳 */
  onRegisterL3Bodies?: (render: L3BodyRender | null) => void;
}) {
  const [data, setData] = useState<UserLookData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  /** M2⑤：看市场提出的待验证问题（断链 #7 的下游消费者） */
  const [marketQuestions, setMarketQuestions] = useState<string[]>([]);
  /**
   * 线框图 Screen 3 ④：细分标准的展开态。
   * **必须放在这里**：本组件在 `if (!data) return <加载中>` 之前才有 hook 区，
   * 放到那之后会让"加载中 → 已加载"两次渲染的 hook 数量不同，直接触发 React #310
   * （2026-09 线上预览就是这样崩的）。
   */
  const [standardOpen, setStandardOpen] = useState(false);
  /**
   * ⏳3 残留 1（线框图 ①「保留层筛选」）：搜索路径图的层筛选。
   * **必须放在组件级早退 `if (!data)` 之前**（hook 顺序，见 tests/hookOrder.test.ts），
   * 而且必须由**这一层**持有：内联区块与二级页① 是同一个组件的两个实例，
   * 状态放在 `SearchPathDetailBlock` 内部就变成"各筛各的"，返回主屏也就不可能保留筛选。
   * 它只是"看哪些层"，不写回数据、不进 localStorage、也不参与任何数值计算。
   */
  const [searchLayerFilter, setSearchLayerFilter] = useState<'all' | SearchPathLayerId>('all');
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

  /**
   * 线框图 Screen 3 ④：细分标准（勾选的需求域，第一个为主标准）。
   * 纯派生值，因此放在组件级早退**之前**算：二级页④（页壳）与内联区块必须共用同一份数据。
   */
  const standard: SegmentStandard = data?.segmentStandard ?? { categories: [] };
  /** 需求域归并（未满足需求 → 需求域），④ 的勾选项用 */
  const categoryOptions = buildCategoryOptions(data?.unmetNeedCandidates ?? []);
  /** M2①：四层流向（确定性计算，AI 无法修改） */
  const searchFlow = computeSearchPathFlow(data?.searchPath);

  /**
   * ⏳3（线框图 ①②③④）：二级页正文 = 与内联**同一个区块组件**，只把 variant 换成 'sheet'，
   * 数据与写回路径（scheduleSave）完全共用，不存在第二份实现。
   * 这里把"当前这份数据能渲染什么"放进 ref：注册给页壳的是一层稳定壳（读 ref），
   * 否则父组件每次渲染都收到新的函数身份 —— 那是 React 里最典型的 setState 死循环。
   */
  const l3BodyRef = useRef<L3BodyRender | null>(null);
  l3BodyRef.current = (id) => {
    if (!data) return null;
    const saveCandidates = (list: UnmetNeedCandidate[]) => scheduleSave({ ...data, unmetNeedCandidates: list });
    if (id === '1')
      return (
        <SearchPathDetailBlock
          searchPath={data.searchPath}
          flow={searchFlow}
          layerFilter={searchLayerFilter}
          onLayerFilterChange={setSearchLayerFilter}
          variant="sheet"
        />
      );
    if (id === '2') return <SearchPreferenceDetailBlock preference={data.searchPreference} variant="sheet" />;
    if (id === '3') {
      return (
        <NeedTreeDetailBlock
          candidates={data.unmetNeedCandidates}
          onChange={saveCandidates}
          onAdd={() => saveCandidates([...data.unmetNeedCandidates, emptyUnmetNeedCandidate()])}
          variant="sheet"
        />
      );
    }
    if (id === '4') {
      return (
        <SegmentStandardBlock
          standard={standard}
          categoryOptions={categoryOptions}
          candidates={data.unmetNeedCandidates}
          detailOpen
          onChange={(next) => scheduleSave({ ...data, segmentStandard: next })}
          variant="sheet"
        />
      );
    }
    return null;
  };

  /**
   * ⏳3：把 ①②③④ 的正文注册给全屏页壳（`L3Sheet`，由 ProjectWorkspace 唯一渲染）。
   * 依赖只放 `[onRegisterL3Bodies, data]`：data 一变就重新注册 → 父组件重渲染 → 页壳拿到新内容；
   * 不能把 `scheduleSave` 之类每次渲染都换身份的回调放进依赖（会无限重注册）。
   */
  useEffect(() => {
    if (!onRegisterL3Bodies || !data) return;
    onRegisterL3Bodies((id, cardId) => l3BodyRef.current?.(id, cardId) ?? null);
    return () => onRegisterL3Bodies(null);
    // searchLayerFilter 也要在依赖里：二级页① 的正文是"注册出去"的元素，
    // 筛选状态变了必须重新注册，页壳才会拿到带新筛选的正文（否则页面上点了筛选不生效）。
  }, [onRegisterL3Bodies, data, searchLayerFilter]);

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载…
      </div>
    );
  }

  const update = (patch: Partial<UserLookData>) => scheduleSave({ ...data, ...patch });

  const addCandidate = () => update({ unmetNeedCandidates: [...data.unmetNeedCandidates, emptyUnmetNeedCandidate()] });

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

      {/* M2：搜索路径图 + 搜索偏好卡（结论先行的第一屏）
          ⏳3：①② 两个区块已抽成独立组件，内联与二级页① ②共用同一份实现（只换 variant） */}
      {(data.searchPath || data.searchPreference) && (
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-4">
          <SearchPathDetailBlock
            searchPath={data.searchPath}
            flow={searchFlow}
            layerFilter={searchLayerFilter}
            onLayerFilterChange={setSearchLayerFilter}
            onOpenDetail={() => onOpenL3?.('1')}
          />

          <SearchPreferenceDetailBlock
            preference={data.searchPreference}
            onOpenDetail={() => onOpenL3?.('2')}
          />
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

      {/* 线框图 Screen 3 ④：细分标准（把需求域标成"作为细分标准"，联动看市场）
          ⏳3：④ 区块已抽成独立组件，内联与二级页④ 共用同一份实现（只换 variant）。 */}
      <SegmentStandardBlock
        standard={standard}
        categoryOptions={categoryOptions}
        candidates={data.unmetNeedCandidates}
        detailOpen={standardOpen}
        onToggleDetail={() => setStandardOpen((v) => !v)}
        onChange={(next) => update({ segmentStandard: next })}
        onOpenDetail={() => onOpenL3?.('4')}
      />

      {/* 未满足需求候选（线框图 ③ 需求分类树）
          ⏳3：③ 区块已抽成独立组件，内联与二级页③ 共用同一份实现（只换 variant）。 */}
      <NeedTreeDetailBlock
        candidates={data.unmetNeedCandidates}
        onChange={(list) => update({ unmetNeedCandidates: list })}
        onAdd={addCandidate}
        onOpenDetail={() => onOpenL3?.('3')}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * ⏳3：看用户侧的 4 个二级页区块（①②③④）
 * 每个区块只实现一次：`variant='inline'` 就是主屏上今天的样子，`variant='sheet'` 是二级页正文，
 * 由 ProjectWorkspace 的全屏页壳 `L3Sheet` 渲染。数据与写回路径都由外层 UserLookView 提供，
 * 区块自身不持有业务状态（局部只有展开/收起这类纯 UI 状态）。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 未满足需求 → 需求域归并（④ 的勾选项，内联与二级页共用） */
export function buildCategoryOptions(
  candidates: UnmetNeedCandidate[]
): { name: string; needs: number; evidence: number }[] {
  const map = new Map<string, { name: string; needs: number; evidence: number }>();
  for (const c of candidates) {
    const name = (c.category || '未分类需求').trim() || '未分类需求';
    const cur = map.get(name) ?? { name, needs: 0, evidence: 0 };
    cur.needs += 1;
    if ((c.evidence?.reviewQuotes?.length ?? 0) > 0 || (c.evidence?.asins?.length ?? 0) > 0) cur.evidence += 1;
    map.set(name, cur);
  }
  return [...map.values()];
}

/**
 * ⏳3 残留 1：二级页① 的层筛选选项（全部 / 认知层 / 考虑层 / 决策层 / 场景层）。
 * 顺序直接取自 `SEARCH_PATH_LAYER_ORDER`（确定性顺序的唯一来源），不在这里另抄一遍。
 */
const SEARCH_PATH_LAYER_FILTERS: { key: 'all' | SearchPathLayerId; label: string }[] = [
  { key: 'all', label: '全部' },
  ...SEARCH_PATH_LAYER_ORDER.map((l) => ({ key: l, label: SEARCH_PATH_LAYER_LABELS[l] })),
];

/** 线框图 ①：搜索路径图（四层漏斗 + 每层流向），内联与二级页① 同一份实现 */
export function SearchPathDetailBlock({
  searchPath,
  flow,
  layerFilter,
  onLayerFilterChange,
  onOpenDetail,
  variant = 'inline',
}: {
  searchPath?: SearchPath;
  flow: SearchPathFlow[];
  /**
   * ⏳3 残留 1：层筛选（线框图 ①「返回看用户主屏，保留层筛选」）。
   * 状态**不在本组件里**，而是由拥有数据的 `UserLookView` 持有后传下来：
   * 内联区块与二级页① 是两个实例，状态放这里就等于各筛各的，返回主屏也就"保留"不了筛选。
   * 它只是"看哪些层"，不写回数据、不持久化、**不参与任何数值计算**。
   */
  layerFilter: 'all' | SearchPathLayerId;
  onLayerFilterChange: (next: 'all' | SearchPathLayerId) => void;
  onOpenDetail?: () => void;
  variant?: L3BlockVariant;
}) {
  const sheet = variant === 'sheet';
  const allLayers = searchPath?.layers ?? [];
  /** 要显示的层：'all' 时按数据里的顺序全给；选了某一层就只给这一层（数据里没有也要给，才能显示空态） */
  const layerIdsToShow: SearchPathLayerId[] =
    layerFilter === 'all' ? allLayers.map((l) => l.layer) : [layerFilter];
  return (
    <Card>
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm font-semibold text-[#1d1d1f]">{sheet ? '① 搜索路径图（二级页①）' : '搜索路径图'}</p>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#86868b]">认知 → 考虑 → 决策 → 场景</span>
            {!sheet && (
              <button
                type="button"
                onClick={onOpenDetail}
                title="打开二级页①：搜索路径详情"
                className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
              >
                查看详情
              </button>
            )}
          </div>
        </div>
        {searchPath?.summary && <p className="text-xs text-[#424245] mb-2 leading-relaxed">{searchPath.summary}</p>}
        {/*
          ⏳3 残留 1 的诚实说明（线框图 ① 写了「拖动结果」，本轮**故意不做**）：
          四层顺序是漏斗的定义（固定），层与层之间的保留比例是**测得**的搜索量（缺量时退化为词数口径）
          确定性算出来的。所以这里不做拖动排序、也不做"把词拖到别的层"：一旦允许拖动，
          漏斗声称的结论就变成可以由一次手势改写的展示内容，而不是量出来的事实。
        */}
        <p className="text-[10px] text-[#86868b] mb-2 leading-relaxed">
          漏斗的四层顺序固定，层间保留比例由各层测得的搜索量（缺量时退化为词数口径）确定性算出：
          <b>不支持拖动排序</b> —— 顺序与比例都是量出来的，不是偏好设置。
        </p>
        {/* M2① 流向（确定性）：每层相对上一层保留多少需求 */}
        {flow.length > 0 && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-3 py-2 mb-3">
            <p className="text-[11px] font-semibold text-indigo-800">流向：{describeSearchPathFlow(flow)}</p>
            <p className="text-[10px] text-indigo-700/70 mt-0.5">
              由各层词搜索量（缺量时退化词数口径）确定性算出，AI 不改这个比例。
            </p>
          </div>
        )}
        {/* ⏳3 残留 1：层筛选（全部 / 认知层 / 考虑层 / 决策层 / 场景层）——只筛行，不重算 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-[#86868b]">按层筛选</span>
          {SEARCH_PATH_LAYER_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onLayerFilterChange(f.key)}
              aria-pressed={layerFilter === f.key}
              title={f.key === 'all' ? '显示全部四层' : `只看${f.label}（不改任何数字）`}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors',
                layerFilter === f.key
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-black/8 bg-white text-[#424245] hover:border-indigo-300 hover:text-indigo-700'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="space-y-3">
          {layerIdsToShow.length === 0 ? (
            <p className="rounded-xl border border-black/8 bg-[#f8f9fb] p-3 text-[11px] text-[#aeaeb2]">
              搜索路径还没有分层数据（未抓取）：先补关键词，或跑一次「看用户」的 AI 生成。
            </p>
          ) : (
            layerIdsToShow.map((layerId) => {
              const layer = allLayers.find((l) => l.layer === layerId);
              const words = layer?.words ?? [];
              const f = flow.find((x) => x.layer === layerId);
              return (
                <div key={layerId} className="rounded-xl border border-black/5 bg-[#f8f9fb] p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-[#1d1d1f]">{SEARCH_PATH_LAYER_LABELS[layerId]}</span>
                    <span className="text-[10px] text-[#86868b]">{SEARCH_PATH_LAYER_HINTS[layerId]}</span>
                    {f && (
                      <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] text-[#86868b]">
                        {f.volume > 0 && <span>本层合计 {f.volume.toLocaleString()}</span>}
                        {f.retention !== null && f.layer !== 'awareness' && (
                          <span className="rounded-full bg-white border border-black/8 px-1.5 py-0.5 font-semibold text-[#424245]">
                            保留 {Math.round(f.retention * 100)}%
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {words.length === 0 ? (
                    /* 空态必须写明白，不能给一个空盒子让人以为页面坏了（也不编一个词出来） */
                    <p className="text-[11px] text-[#aeaeb2] mt-2">该层暂无关键词证据</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {words.map((w) => (
                        <span
                          key={`${layerId}-${w.word}`}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white border border-black/8 text-[11px] text-[#424245]"
                        >
                          {w.word}
                          {w.share !== undefined && <span className="text-[#aeaeb2]">占比 {Math.round(w.share * 100)}%</span>}
                          {w.volume !== undefined && (
                            <span className="text-[#aeaeb2]">月搜索量 {w.volume.toLocaleString()}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {layer?.note && <p className="text-[10px] text-[#86868b] mt-1.5 leading-relaxed">{layer.note}</p>}
                  {f?.note ? <p className="text-[10px] text-amber-600 mt-1 leading-relaxed">{f.note}</p> : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
}

/** 线框图 ②：搜索偏好画像，内联与二级页② 同一份实现 */
export function SearchPreferenceDetailBlock({
  preference,
  onOpenDetail,
  variant = 'inline',
}: {
  preference?: SearchPreference;
  onOpenDetail?: () => void;
  variant?: L3BlockVariant;
}) {
  const sheet = variant === 'sheet';
  return (
    <Card>
      <div className="p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[#1d1d1f]">{sheet ? '② 搜索偏好画像（二级页②）' : '搜索偏好'}</p>
          {!sheet && (
            <button
              type="button"
              onClick={onOpenDetail}
              title="打开二级页②：搜索偏好详情"
              className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
            >
              查看详情
            </button>
          )}
        </div>
        {preference?.priceSensitivity && (
          <div>
            <p className="text-[11px] text-[#86868b]">价格敏感度</p>
            <p className="text-sm font-semibold text-[#1d1d1f]">{PRICE_SENSITIVITY_LABELS[preference.priceSensitivity]}</p>
            {preference.priceSensitivityNote && (
              <p className="text-[10px] text-[#86868b] mt-0.5">{preference.priceSensitivityNote}</p>
            )}
          </div>
        )}
        {preference?.attributeMix && (
          <div>
            <p className="text-[11px] text-[#86868b]">词性倾向</p>
            <p className="text-xs text-[#424245] leading-relaxed">{preference.attributeMix}</p>
          </div>
        )}
        {preference?.longTailShare !== undefined && (
          <div>
            <p className="text-[11px] text-[#86868b]">长尾结构</p>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 rounded-full bg-[#e5e5ea] overflow-hidden">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${Math.round(preference.longTailShare * 100)}%` }}
                />
              </div>
              <span className="text-[11px] text-[#424245]">长尾占 {Math.round(preference.longTailShare * 100)}%</span>
            </div>
          </div>
        )}
        {preference?.decisionFocus && preference.decisionFocus.length > 0 && (
          <div>
            <p className="text-[11px] text-[#86868b] mb-1">决策焦点（买家下单前对比什么）</p>
            <div className="flex flex-wrap gap-1.5">
              {preference.decisionFocus.map((f) => (
                <span key={f} className="px-2 py-0.5 rounded-lg bg-indigo-50 border border-indigo-100 text-[11px] text-indigo-700">
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

/** 线框图 ④：细分标准（勾选需求域 → 看市场方案 A 优先按它切），内联与二级页④ 同一份实现 */
export function SegmentStandardBlock({
  standard,
  categoryOptions,
  candidates,
  detailOpen,
  onToggleDetail,
  onChange,
  onOpenDetail,
  variant = 'inline',
}: {
  standard: SegmentStandard;
  categoryOptions: { name: string; needs: number; evidence: number }[];
  candidates: UnmetNeedCandidate[];
  /** 内联时的"展开明细"状态；二级页里恒为展开（这一页本身就是明细页） */
  detailOpen: boolean;
  onToggleDetail?: () => void;
  onChange: (next: SegmentStandard) => void;
  onOpenDetail?: () => void;
  variant?: L3BlockVariant;
}) {
  const sheet = variant === 'sheet';
  const showDetail = sheet || detailOpen;
  const toggleCategory = (name: string) => {
    const has = standard.categories.includes(name);
    const categories = has ? standard.categories.filter((c) => c !== name) : [...standard.categories, name];
    onChange({ ...standard, categories, updatedAt: new Date().toISOString() });
  };
  const setPrimary = (name: string) => {
    onChange({
      ...standard,
      categories: [name, ...standard.categories.filter((c) => c !== name)],
      updatedAt: new Date().toISOString(),
    });
  };
  return (
    <Card>
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-indigo-600" />
            <p className="text-sm font-semibold text-[#1d1d1f]">{sheet ? '④ 细分标准设置（二级页④）' : '④ 细分标准'}</p>
            <span className="text-[11px] text-[#aeaeb2]">勾选"作为细分标准"的需求域 → 看市场的方案 A 会优先按它切</span>
          </div>
          <div className="flex items-center gap-3">
            {!sheet && (
              <button
                type="button"
                onClick={onOpenDetail}
                title="打开二级页④：细分标准设置"
                className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
              >
                查看详情
              </button>
            )}
            {!sheet && onToggleDetail && (
              <button
                type="button"
                onClick={onToggleDetail}
                className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
              >
                {detailOpen ? '收起明细' : '细分标准设置（二级页④）'}
              </button>
            )}
          </div>
        </div>

        <p className="text-[11px] text-[#86868b] mb-3 leading-relaxed">
          细分标准决定"后面所有对比按什么切"。这里勾的是**需求域**（来自上面的需求分类树），
          第一个勾选的是主标准；不勾也可以，看市场会退回默认的三方案对比。
        </p>

        {categoryOptions.length === 0 ? (
          <p className="text-[11px] text-amber-700">还没有需求域：先在上面加至少 1 条未满足需求（填「需求域」字段）。</p>
        ) : (
          <div className="space-y-1.5">
            {categoryOptions.map((c) => {
              const idx = standard.categories.indexOf(c.name);
              const checked = idx >= 0;
              return (
                <div key={c.name} className="flex flex-wrap items-center gap-2 rounded-xl border border-black/8 bg-[#f8f9fb] px-3 py-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCategory(c.name)}
                      className="w-3.5 h-3.5 accent-indigo-600"
                    />
                    <span className="text-[12px] font-semibold text-[#1d1d1f]">{c.name}</span>
                  </label>
                  <span className="text-[10px] text-[#86868b]">
                    {c.needs} 条需求{c.evidence > 0 ? ` · ${c.evidence} 条带证据` : ' · 暂无证据'}
                  </span>
                  {checked && (
                    <span className="ml-auto flex items-center gap-2">
                      {idx === 0 ? (
                        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">主标准</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPrimary(c.name)}
                          className="rounded-lg border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#86868b] hover:border-indigo-300 hover:text-indigo-700"
                        >
                          设为主标准
                        </button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}

            <div className="pt-1">
              <label className="text-[11px] text-[#86868b]">主标准的理由（一句话，给管理层看的）</label>
              <input
                value={standard.basis ?? ''}
                onChange={(e) =>
                  onChange({ ...standard, categories: standard.categories, basis: e.target.value, updatedAt: new Date().toISOString() })
                }
                placeholder="例如：睡姿决定高度需求，且#U3 需求在评论里被反复抱怨"
                className={inputCls}
              />
            </div>

            {showDetail && (
              <div className="mt-2 rounded-xl border border-black/8 bg-white px-3 py-2">
                <p className="text-[11px] font-semibold text-[#1d1d1f] mb-1">细分标准下的需求明细（二级页④）</p>
                <ul className="space-y-0.5">
                  {candidates.map((c) => (
                    <li key={c.id} className="text-[10px] text-[#424245] leading-relaxed">
                      · <span className="text-[#86868b]">{(c.category || '未分类').trim()}</span> ｜ {(c.needStatement || '(未填写)').trim()}
                      {c.evidence && (
                        <span className="text-[#aeaeb2]">
                          （关键词 {(c.evidence.keywords ?? []).length} · 评论原文 {(c.evidence.reviewQuotes ?? []).length} · 覆盖 ASIN {(c.evidence.asins ?? []).length}）
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** 线框图 ③：需求分类树（未满足需求按需求域分组 + 证据链），内联与二级页③ 同一份实现 */
export function NeedTreeDetailBlock({
  candidates,
  onChange,
  onAdd,
  onOpenDetail,
  variant = 'inline',
}: {
  candidates: UnmetNeedCandidate[];
  /** 交给外层统一持久化（内联走 debounce 保存，二级页走同一条路径） */
  onChange: (next: UnmetNeedCandidate[]) => void;
  onAdd: () => void;
  onOpenDetail?: () => void;
  variant?: L3BlockVariant;
}) {
  const sheet = variant === 'sheet';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[#1d1d1f]">{sheet ? '③ 需求分类树详情' : '未满足需求候选'}</p>
          <p className="text-xs text-[#aeaeb2] mt-0.5">
            每个候选都要能说明：目标用户 + 场景 + 任务 + 当前替代方案 + 证据强度
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!sheet && (
            <button
              type="button"
              onClick={onOpenDetail}
              title="打开二级页③：需求分类树详情"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-100 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-200 transition-all active:scale-[0.98]"
            >
              查看详情
            </button>
          )}
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
          >
            <Plus className="w-3.5 h-3.5" /> 添加未满足需求
          </button>
        </div>
      </div>
      {candidates.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm text-[#aeaeb2]">尚未添加未满足需求候选</p>
        </Card>
      ) : (
        groupCandidatesByCategory(candidates).map(([cat, list]) => (
          <div key={cat} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#1d1d1f]">{cat}</span>
              <span className="text-[10px] text-[#86868b]">{list.length} 条需求</span>
              {!sheet && (
                <button
                  type="button"
                  onClick={onOpenDetail}
                  title="打开二级页③：需求分类树详情"
                  className="ml-auto text-[10px] font-medium text-indigo-600 hover:text-indigo-700"
                >
                  查看详情
                </button>
              )}
            </div>
            {list.map((c) => {
              const idx = candidates.findIndex((x) => x.id === c.id);
              return (
                <UnmetNeedCard
                  key={c.id}
                  index={idx}
                  candidate={c}
                  onChange={(patch) => onChange(candidates.map((x) => (x.id === c.id ? { ...x, ...patch } : x)))}
                  onRemove={() => onChange(candidates.filter((x) => x.id !== c.id))}
                />
              );
            })}
          </div>
        ))
      )}
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
