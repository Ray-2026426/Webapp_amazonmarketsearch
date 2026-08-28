import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TrendingUp,
  Sparkles,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import { toast } from 'sonner';
import {
  loadMarketLook,
  saveMarketLook,
  computeMarketProgress,
  type MarketContext,
  type MarketLookData,
} from '../utils/marketLook';
import { updateLookProgress } from '../utils/projectStore';
import { SegmentScoreCards } from './SegmentScoreCards';
import { runLookAnalysis, type MarketAnalysisOutput } from '../utils/lookAi';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function MarketLookView({
  userId,
  project,
  marketContext,
  onProjectChange,
  onOpenMarketTool,
  onNavigateCompetitor,
}: {
  userId: string;
  project: ResearchProject;
  marketContext: MarketContext;
  onProjectChange: (updated: ResearchProject) => void;
  onOpenMarketTool?: () => void;
  onNavigateCompetitor?: () => void;
}) {
  const [data, setData] = useState<MarketLookData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [aiRunning, setAiRunning] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadMarketLook(userId, project.id).then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  const persist = useCallback(
    async (d: MarketLookData) => {
      setSaveState('saving');
      try {
        await saveMarketLook(userId, project.id, d);
        const progress = computeMarketProgress(d);
        const updated = await updateLookProgress(userId, project.id, 'market', {
          ...project.fiveLookProgress.market,
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
    (next: MarketLookData) => {
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

  const update = (patch: Partial<MarketLookData>) => scheduleSave({ ...data, ...patch });
  const progress = project.fiveLookProgress.market;
  const selectedSegment = data.selectedOpportunitySegment?.trim() || '';
  const evidenceCount = data.keyEvidences.filter((s) => s.trim()).length;
  const riskCount = data.risks.filter((s) => s.trim()).length;
  const judgement = selectedSegment
    ? `已选择「${selectedSegment}」作为目标细分市场，下一步应围绕它拆解三类竞对。`
    : data.attractiveness.trim()
      ? '已有市场吸引力判断，但还没有选择目标细分市场。'
      : '还没有形成可用于竞品拆解的细分市场判断。';
  const marketSource = marketContext.sourceLabel || data.evidence?.sourceLabel || '未捕获';

  const runAi = async () => {
    setAiRunning(true);
    try {
      const res = await runLookAnalysis('market');
      if (!res.ok || !res.data) {
        toast.error(res.error || 'AI 分析失败');
        return;
      }
      const out = res.data as MarketAnalysisOutput;
      update({
        attractiveness: out.attractiveness ?? data.attractiveness,
        keyEvidences: Array.isArray(out.keyEvidences) ? out.keyEvidences : data.keyEvidences,
        risks: Array.isArray(out.risks) ? out.risks : data.risks,
        openQuestions: Array.isArray(out.openQuestions) ? out.openQuestions : data.openQuestions,
      });
    } finally {
      setAiRunning(false);
    }
  };

  const updateListItem = (key: 'keyEvidences' | 'risks' | 'openQuestions', index: number, value: string) => {
    const next = [...data[key]];
    next[index] = value;
    update({ [key]: next } as Partial<MarketLookData>);
  };

  const addListItem = (key: 'keyEvidences' | 'risks' | 'openQuestions') => {
    update({ [key]: [...data[key], ''] } as Partial<MarketLookData>);
  };

  const removeListItem = (key: 'keyEvidences' | 'risks' | 'openQuestions', index: number) => {
    update({ [key]: data[key].filter((_, i) => i !== index) } as Partial<MarketLookData>);
  };

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Market"
        title="看市场 · 细分机会池"
        judgement={judgement}
        description="这里不再复述市场大盘明细，而是判断哪些细分市场水涨船高、是否供小于求，并选择一个目标细分市场进入三竞对拆解。"
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[progress.status]} · {progress.completionPercent}%
          </span>
        }
        metrics={[
          { label: '目标细分', value: selectedSegment || '未选择', tone: selectedSegment ? 'brand' : 'warn' },
          { label: '商品样本', value: `${marketContext.sampleSize || data.evidence?.sampleSize || 0}`, tone: marketContext.sampleSize ? 'brand' : 'neutral' },
          { label: '历史月份', value: `${marketContext.months?.length || data.evidence?.months?.length || 0}`, tone: marketContext.months?.length ? 'brand' : 'neutral' },
          { label: '数据来源', value: marketSource, tone: marketContext.isDemo || data.evidence?.isDemo ? 'warn' : 'neutral' },
        ]}
        sections={[
          {
            title: '市场判断',
            items: [data.attractiveness],
            emptyText: '先形成市场吸引力判断：规模、趋势、竞争结构、价格带和进入窗口是否支持继续投入。',
            tone: data.attractiveness.trim() ? 'good' : 'neutral',
          },
          {
            title: '关键证据',
            items: data.keyEvidences,
            emptyText: '至少沉淀 3 条关键证据，例如增长趋势、集中度、价格带、上新窗口或供需缺口。',
            tone: evidenceCount >= 3 ? 'good' : 'warn',
          },
          {
            title: '风险 / 待验证',
            items: [...data.risks, ...data.openQuestions],
            emptyText: '记录会改变进入判断的风险，例如季节性、合规、头部垄断、利润或样本偏差。',
            tone: riskCount > 0 ? 'warn' : 'neutral',
          },
        ]}
        nextAction={{
          label: selectedSegment ? '去看竞品拆解' : '选择目标细分',
          description: selectedSegment
            ? '围绕该细分市场选择绝对头部、强力跟随者和新链接，拆分产品力与运营力，寻找缝隙。'
            : '先在细分市场评分中选择一个目标细分市场，再进入看竞品。',
          onClick: selectedSegment ? onNavigateCompetitor : onOpenMarketTool,
        }}
        toolAction={onOpenMarketTool ? { label: '查看市场明细', onClick: onOpenMarketTool } : undefined}
      />

      {/* 头部 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#1d1d1f]">看市场 · 市场判断</h3>
            <p className="text-sm text-[#86868b] mt-0.5 max-w-xl">
              判断需求所在市场的规模、趋势和进入环境，形成吸引力判断与关键证据。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={aiRunning}
            onClick={() => void runAi()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {aiRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            AI 生成结论
          </button>
          <SaveBadge state={saveState} />
        </div>
      </div>

      {/* 细分市场评分（确定性公式，机会分排序） */}
      <SegmentScoreCards
        onOpenMarketTool={onOpenMarketTool ?? (() => {})}
        selectedOpportunitySegment={data.selectedOpportunitySegment}
        onSelectOpportunitySegment={(segment) => update({ selectedOpportunitySegment: segment ?? '' })}
      />

      {/* 市场吸引力判断 */}
      <Card>
        <div className="p-5">
          <p className="text-sm font-semibold text-[#1d1d1f] mb-2">市场吸引力判断</p>
          <textarea
            value={data.attractiveness}
            onChange={(e) => update({ attractiveness: e.target.value })}
            rows={3}
            placeholder="这个市场值不值得进？规模、趋势、竞争结构、价格带和进入窗口的综合判断…"
            className={inputCls}
          />
        </div>
      </Card>

      {/* 关键证据 / 风险 / 待验证问题 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StringListCard title="关键证据（3–5 条）" hint="用数据支撑判断，例如：头部品牌集中度、价格带分布、月度趋势" value={data.keyEvidences} onAdd={() => addListItem('keyEvidences')} onChange={(i, v) => updateListItem('keyEvidences', i, v)} onRemove={(i) => removeListItem('keyEvidences', i)} />
        <StringListCard title="主要市场风险" hint="例如：季节性波动、退货率、合规、供给集中" value={data.risks} onAdd={() => addListItem('risks')} onChange={(i, v) => updateListItem('risks', i, v)} onRemove={(i) => removeListItem('risks', i)} />
      </div>

      <Card>
        <div className="p-5">
          <p className="text-sm font-semibold text-[#1d1d1f] mb-1">对看用户 / 看竞品的待验证问题（选填）</p>
          <p className="text-xs text-[#aeaeb2] mb-3">这些问题将带到后续视角去验证</p>
          <div className="space-y-2">
            {data.openQuestions.map((q, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={q} onChange={(e) => updateListItem('openQuestions', i, e.target.value)} placeholder={`问题 ${i + 1}`} className={inputCls} />
                <button type="button" onClick={() => removeListItem('openQuestions', i)} className="shrink-0 w-8 h-8 rounded-lg hover:bg-[#f5f5f7] flex items-center justify-center text-[#aeaeb2] hover:text-rose-500 transition-colors"><X className="w-4 h-4" /></button>
              </div>
            ))}
            <button type="button" onClick={() => addListItem('openQuestions')} className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 transition-colors">
              <Plus className="w-3.5 h-3.5" /> 添加问题
            </button>
          </div>
        </div>
      </Card>
    </div>
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

function SaveBadge({ state }: { state: SaveState }) {
  if (state === 'idle' || state === 'saved') return null;
  const map: Record<SaveState, { icon: typeof CheckCircle2; text: string; cls: string }> = {
    idle: { icon: CheckCircle2, text: '', cls: '' },
    saving: { icon: Loader2, text: '保存中…', cls: 'text-amber-600' },
    saved: { icon: CheckCircle2, text: '', cls: '' },
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
