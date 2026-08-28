import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Crosshair,
  Database,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  MapPin,
} from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  loadCompetitorLook,
  saveCompetitorLook,
  makeCompetitorEvidence,
  computeCompetitorProgress,
  type CompetitorContext,
  type CompetitorEvidence,
  type CompetitorLookData,
} from '../utils/competitorLook';
import { updateLookProgress } from '../utils/projectStore';
import { CompetitorPickerPanel } from './CompetitorPickerPanel';
import type { ResearchProject } from '../types/researchProject';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function CompetitorLookView({
  userId,
  project,
  competitorContext,
  onProjectChange,
  onOpenCompetitorTool,
}: {
  userId: string;
  project: ResearchProject;
  competitorContext: CompetitorContext;
  onProjectChange: (updated: ResearchProject) => void;
  onOpenCompetitorTool?: () => void;
}) {
  const [data, setData] = useState<CompetitorLookData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCompetitorLook(userId, project.id).then((d) => {
      if (!cancelled) setData(d);
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

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载…
      </div>
    );
  }

  const update = (patch: Partial<CompetitorLookData>) => scheduleSave({ ...data, ...patch });

  const updateList = (key: 'samplePool' | 'benchmarkAsins' | 'gaps', index: number, value: string) => {
    const next = [...data[key]];
    next[index] = value;
    update({ [key]: next } as Partial<CompetitorLookData>);
  };
  const addList = (key: 'samplePool' | 'benchmarkAsins' | 'gaps') => update({ [key]: [...data[key], ''] } as Partial<CompetitorLookData>);
  const removeList = (key: 'samplePool' | 'benchmarkAsins' | 'gaps', index: number) => update({ [key]: data[key].filter((_, i) => i !== index) } as Partial<CompetitorLookData>);

  const captureEvidence = () => {
    if (!competitorContext.loaded) return;
    update({ evidence: makeCompetitorEvidence(competitorContext) });
  };

  return (
    <div className="space-y-4">
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
        <SaveBadge state={saveState} />
      </div>

      {/* 数据上下文 */}
      <Card>
        <div className="p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm font-semibold text-[#1d1d1f]">数据上下文</p>
            {competitorContext.loaded && (
              <button
                type="button"
                onClick={captureEvidence}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all active:scale-[0.98]"
              >
                <Database className="w-3.5 h-3.5" />
                {data.evidence ? '更新捕获证据' : '捕获为项目证据'}
              </button>
            )}
          </div>
          {competitorContext.loaded ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#86868b]">
              <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {competitorContext.marketplace}</span>
              <span>竞品 ASIN {competitorContext.asinCount}</span>
              {competitorContext.isDemo && <span className="rounded-full bg-indigo-50 text-indigo-600 px-2 py-0.5 text-[10px] font-semibold">示例数据</span>}
            </div>
          ) : (
            <p className="text-xs text-[#aeaeb2]">
              尚未加载竞品数据 —— 可到左侧「竞品分析」选定 ASIN 后再回来捕获。
            </p>
          )}
        </div>
      </Card>

      {data.evidence && <CompetitorEvidenceCard evidence={data.evidence} />}

      {/* 自动挑选对标竞品（机会细分 → 头部/跟随者/新品） */}
      <CompetitorPickerPanel
        onOpenCompetitorTool={onOpenCompetitorTool ?? (() => {})}
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

function CompetitorEvidenceCard({ evidence }: { evidence: CompetitorEvidence }) {
  return (
    <Card className="border-indigo-100 bg-indigo-50/40">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-4 h-4 text-indigo-600" />
          <p className="text-sm font-semibold text-[#1d1d1f]">已捕获的竞品证据</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#86868b]">
          <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {evidence.marketplace}</span>
          <span>竞品 ASIN {evidence.asinCount}</span>
        </div>
      </div>
    </Card>
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
