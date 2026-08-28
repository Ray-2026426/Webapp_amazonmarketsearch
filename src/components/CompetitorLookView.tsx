import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Crosshair,
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
  loadCompetitorLook,
  saveCompetitorLook,
  computeCompetitorProgress,
  type CompetitorContext,
  type CompetitorLookData,
} from '../utils/competitorLook';
import { updateLookProgress } from '../utils/projectStore';
import { loadMarketLook, type MarketLookData } from '../utils/marketLook';
import { CompetitorPickerPanel } from './CompetitorPickerPanel';
import { runLookAnalysis, type CompetitorAnalysisOutput } from '../utils/lookAi';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function CompetitorLookView({
  userId,
  project,
  competitorContext,
  onProjectChange,
  onOpenCompetitorTool,
  onNavigateSelf,
}: {
  userId: string;
  project: ResearchProject;
  competitorContext: CompetitorContext;
  onProjectChange: (updated: ResearchProject) => void;
  onOpenCompetitorTool?: () => void;
  onNavigateSelf?: () => void;
}) {
  const [data, setData] = useState<CompetitorLookData | null>(null);
  const [marketLook, setMarketLook] = useState<MarketLookData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [aiRunning, setAiRunning] = useState(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadCompetitorLook(userId, project.id), loadMarketLook(userId, project.id)]).then(([d, m]) => {
      if (cancelled) return;
      setData(d);
      setMarketLook(m);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, project.id]);

  const persist = useCallback(
    async (d: CompetitorLookData) => {
      setSaveState('saving');
      try {
        await saveCompetitorLook(userId, project.id, d);
        const progress = computeCompetitorProgress(d);
        const updated = await updateLookProgress(userId, project.id, 'competitor', {
          ...project.fiveLookProgress.competitor,
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
    (next: CompetitorLookData) => {
      setData(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persist(next);
      }, 500);
    },
    [persist]
  );

  if (!data || !marketLook) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载…
      </div>
    );
  }

  const update = (patch: Partial<CompetitorLookData>) => scheduleSave({ ...data, ...patch });

  const runAi = async () => {
    setAiRunning(true);
    try {
      const res = await runLookAnalysis('competitor');
      if (!res.ok || !res.data) {
        toast.error(res.error || 'AI 分析失败');
        return;
      }
      const out = res.data as CompetitorAnalysisOutput;
      update({
        samplePool: Array.isArray(out.samplePool) ? out.samplePool : data.samplePool,
        benchmarkAsins: Array.isArray(out.benchmarkAsins) ? out.benchmarkAsins : data.benchmarkAsins,
        productPowerFindings: Array.isArray(out.productPowerFindings) ? out.productPowerFindings : data.productPowerFindings,
        operationPowerFindings: Array.isArray(out.operationPowerFindings) ? out.operationPowerFindings : data.operationPowerFindings,
        barriers: out.barriers ?? data.barriers,
        needMatrix: out.needMatrix ?? data.needMatrix,
        gaps: Array.isArray(out.gaps) ? out.gaps : data.gaps,
      });
    } finally {
      setAiRunning(false);
    }
  };

  const updateList = (key: 'samplePool' | 'benchmarkAsins' | 'productPowerFindings' | 'operationPowerFindings' | 'gaps', index: number, value: string) => {
    const next = [...data[key]];
    next[index] = value;
    update({ [key]: next } as Partial<CompetitorLookData>);
  };
  const addList = (key: 'samplePool' | 'benchmarkAsins' | 'productPowerFindings' | 'operationPowerFindings' | 'gaps') => update({ [key]: [...data[key], ''] } as Partial<CompetitorLookData>);
  const removeList = (key: 'samplePool' | 'benchmarkAsins' | 'productPowerFindings' | 'operationPowerFindings' | 'gaps', index: number) => update({ [key]: data[key].filter((_, i) => i !== index) } as Partial<CompetitorLookData>);
  const progress = project.fiveLookProgress.competitor;
  const selectedSegment = marketLook.selectedOpportunitySegment?.trim() || '';
  const hasThreeCompetitors = data.benchmarkAsins.filter((s) => s.trim()).length >= 2 && data.samplePool.filter((s) => s.trim()).length >= 3;
  const productFindings = data.productPowerFindings.length > 0 ? data.productPowerFindings : [data.needMatrix].filter(Boolean);
  const operationFindings = data.operationPowerFindings.length > 0 ? data.operationPowerFindings : [data.barriers].filter(Boolean);
  const judgement = hasThreeCompetitors
    ? `已形成竞品样本，正在判断「${selectedSegment || '目标细分'}」里对手的产品力与运营力破绽。`
    : selectedSegment
      ? `已选定「${selectedSegment}」，但还没有完成头部、跟随者、新链接三类竞对样本。`
      : '还没有从看市场带入目标细分市场，竞品拆解缺少聚焦对象。';

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Competitor"
        title="看竞品 · 三类竞对拆解"
        judgement={judgement}
        description="围绕目标细分市场选择绝对头部、强力跟随者和新链接，分别拆产品力与运营力，找到用户需求和现有供给之间的缝隙。"
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[progress.status]} · {progress.completionPercent}%
          </span>
        }
        metrics={[
          { label: '目标细分', value: selectedSegment || '未选择', tone: selectedSegment ? 'brand' : 'warn' },
          { label: '竞品样本', value: `${data.samplePool.filter((s) => s.trim()).length}`, tone: data.samplePool.length ? 'brand' : 'neutral' },
          { label: '标杆 ASIN', value: `${data.benchmarkAsins.filter((s) => s.trim()).length}`, tone: data.benchmarkAsins.length ? 'brand' : 'neutral' },
          { label: '全局竞品', value: `${competitorContext.asinCount || data.evidence?.asinCount || 0}`, tone: competitorContext.asinCount ? 'brand' : 'neutral' },
        ]}
        sections={[
          {
            title: '产品力拆解',
            items: productFindings,
            emptyText: '记录对手在功能、材质、设计、体验和差评痛点上的优势与弱点。',
            tone: productFindings.length ? 'good' : 'neutral',
          },
          {
            title: '运营力拆解',
            items: operationFindings,
            emptyText: '记录对手在 Listing、主图、关键词覆盖、流量结构、价格和评价壁垒上的强弱。',
            tone: operationFindings.length ? 'good' : 'neutral',
          },
          {
            title: '缝隙 / 破绽',
            items: data.gaps,
            emptyText: '还没有找到现有竞品未充分满足的产品或运营缺口。',
            tone: data.gaps.length ? 'warn' : 'neutral',
          },
        ]}
        nextAction={{
          label: data.gaps.length ? '去看自己承接' : selectedSegment ? '补齐竞品拆解' : '回到看市场',
          description: data.gaps.length
            ? '下一步判断我方是否有能力抓住这些缝隙：能否做出差异化、利润是否成立、资源是否接得住。'
            : selectedSegment
              ? '先填充三类竞对，并分别补充产品力、运营力和未满足缺口。'
              : '先在看市场选择目标细分市场，再回来拆竞品。',
          onClick: data.gaps.length ? onNavigateSelf : undefined,
        }}
        toolAction={onOpenCompetitorTool ? { label: '查看竞品明细', onClick: onOpenCompetitorTool } : undefined}
      />

      {/* 头部 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
            <Crosshair className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#1d1d1f]">看竞品 · 竞争格局</h3>
            <p className="text-sm text-[#86868b] mt-0.5 max-w-xl">
              理解现有竞品如何满足需求、壁垒在哪，以及为什么仍存在未满足需求。
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

      {/* 自动挑选对标竞品（机会细分 → 头部/跟随者/新品） */}
      <CompetitorPickerPanel
        onOpenCompetitorTool={onOpenCompetitorTool ?? (() => {})}
        preferredSegment={marketLook.selectedOpportunitySegment}
        onPicked={(asins, seg) => {
          // 填充竞品样本池（带角色标注）与标杆 ASIN
          const pool = data.samplePool.slice();
          for (const a of asins) {
            if (!pool.includes(a)) pool.push(a);
          }
          const benchmark = data.benchmarkAsins.slice();
          for (const a of asins.slice(0, 2)) {
            if (!benchmark.includes(a)) benchmark.push(a);
          }
          update({ samplePool: pool, benchmarkAsins: benchmark });
        }}
      />

      {/* 竞品样本池 / 标杆 ASIN */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StringListCard title="竞品样本池（分层）" hint="例如：头部款 / 腰部款 / 新品款，按销量或价格分层" value={data.samplePool} onAdd={() => addList('samplePool')} onChange={(i, v) => updateList('samplePool', i, v)} onRemove={(i) => removeList('samplePool', i)} />
        <StringListCard title="标杆 ASIN" hint="最值得对标的具体 ASIN" value={data.benchmarkAsins} onAdd={() => addList('benchmarkAsins')} onChange={(i, v) => updateList('benchmarkAsins', i, v)} onRemove={(i) => removeList('benchmarkAsins', i)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <StringListCard title="产品力拆解" hint="功能、材质、设计、场景适配、体验痛点、差评原因" value={data.productPowerFindings} onAdd={() => addList('productPowerFindings')} onChange={(i, v) => updateList('productPowerFindings', i, v)} onRemove={(i) => removeList('productPowerFindings', i)} />
        <StringListCard title="运营力拆解" hint="Listing 表达、主图策略、关键词覆盖、流量结构、价格、评价壁垒" value={data.operationPowerFindings} onAdd={() => addList('operationPowerFindings')} onChange={(i, v) => updateList('operationPowerFindings', i, v)} onRemove={(i) => removeList('operationPowerFindings', i)} />
      </div>

      {/* 产品与经营壁垒 / 需求满足矩阵 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="p-5">
            <p className="text-sm font-semibold text-[#1d1d1f] mb-2">产品与经营壁垒</p>
            <textarea value={data.barriers} onChange={(e) => update({ barriers: e.target.value })} rows={4} placeholder="竞品在产品、Listing、价格、供应链、评论上的壁垒…" className={inputCls} />
          </div>
        </Card>
        <Card>
          <div className="p-5">
            <p className="text-sm font-semibold text-[#1d1d1f] mb-2">用户需求满足矩阵（选填）</p>
            <textarea value={data.needMatrix} onChange={(e) => update({ needMatrix: e.target.value })} rows={4} placeholder="哪些需求被谁满足、满足程度如何…" className={inputCls} />
          </div>
        </Card>
      </div>

      {/* 未充分满足的产品缺口 */}
      <StringListCard title="未充分满足的产品缺口" hint="现有竞品没有解决好的点，对应看用户里的未满足需求" value={data.gaps} onAdd={() => addList('gaps')} onChange={(i, v) => updateList('gaps', i, v)} onRemove={(i) => removeList('gaps', i)} />
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
