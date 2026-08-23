import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TrendingUp,
  Database,
  Plus,
  X,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  MapPin,
  Layers,
  CalendarRange,
} from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import {
  loadMarketLook,
  saveMarketLook,
  makeMarketEvidence,
  computeMarketProgress,
  type MarketContext,
  type MarketEvidence,
  type MarketLookData,
} from '../utils/marketLook';
import { updateProject } from '../utils/projectStore';
import type { ResearchProject } from '../types/researchProject';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MarketLookView({
  userId,
  project,
  marketContext,
  onProjectChange,
}: {
  userId: string;
  project: ResearchProject;
  marketContext: MarketContext;
  onProjectChange: (updated: ResearchProject) => void;
}) {
  const [data, setData] = useState<MarketLookData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
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
        const nextProgress = {
          ...project.fiveLookProgress,
          market: {
            ...project.fiveLookProgress.market,
            status: progress.status,
            completionPercent: progress.completionPercent,
            missingRequirements: progress.missingRequirements,
            updatedAt: new Date().toISOString(),
          },
        };
        const updated = await updateProject(userId, project.id, { fiveLookProgress: nextProgress });
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

  const captureEvidence = () => {
    if (!marketContext.loaded) return;
    update({ evidence: makeMarketEvidence(marketContext) });
  };

  return (
    <div className="space-y-4">
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
        <SaveBadge state={saveState} />
      </div>

      {/* 数据上下文 */}
      <Card>
        <div className="p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm font-semibold text-[#1d1d1f]">数据上下文</p>
            {marketContext.loaded && (
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
          {marketContext.loaded ? (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#86868b]">
              <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {marketContext.marketplace}</span>
              <span className="inline-flex items-center gap-1"><Layers className="w-3.5 h-3.5" /> 样本 {marketContext.sampleSize}</span>
              <span className="inline-flex items-center gap-1"><CalendarRange className="w-3.5 h-3.5" /> {marketContext.months.length} 个月</span>
              <span>{marketContext.sourceLabel || '未标注来源'}</span>
              {marketContext.isDemo && <span className="rounded-full bg-indigo-50 text-indigo-600 px-2 py-0.5 text-[10px] font-semibold">示例数据</span>}
            </div>
          ) : (
            <p className="text-xs text-[#aeaeb2]">
              尚未加载市场数据 —— 可到左侧「市场大盘」上传 Excel 或加载示例数据后再回来捕获。
            </p>
          )}
        </div>
      </Card>

      {/* 已捕获证据 */}
      {data.evidence && <EvidenceCard evidence={data.evidence} />}

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

function EvidenceCard({ evidence }: { evidence: MarketEvidence }) {
  return (
    <Card className="border-indigo-100 bg-indigo-50/40">
      <div className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-4 h-4 text-indigo-600" />
          <p className="text-sm font-semibold text-[#1d1d1f]">已捕获的市场证据</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-[#86868b]">
          <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {evidence.marketplace}</span>
          <span>样本 {evidence.sampleSize}</span>
          <span>{evidence.months.length} 个月</span>
          <span>{evidence.sourceLabel || '未标注来源'}</span>
          <span>捕获于 {formatDate(evidence.capturedAt)}</span>
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
