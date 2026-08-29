import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import { SegmentScoreCards } from './SegmentScoreCards';
import {
  computeMarketProgress,
  loadMarketLook,
  saveMarketLook,
  type MarketContext,
  type MarketLookData,
} from '../utils/marketLook';
import { updateLookProgress } from '../utils/projectStore';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';

export function MarketLookView({
  userId,
  project,
  marketContext,
  onProjectChange,
  onOpenMarketTool,
}: {
  userId: string;
  project: ResearchProject;
  marketContext: MarketContext;
  onProjectChange: (updated: ResearchProject) => void;
  onOpenMarketTool?: () => void;
  onNavigateCompetitor?: () => void;
}) {
  const [data, setData] = useState<MarketLookData | null>(null);
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
    async (next: MarketLookData) => {
      await saveMarketLook(userId, project.id, next);
      const progress = computeMarketProgress(next);
      const updated = await updateLookProgress(userId, project.id, 'market', {
        ...project.fiveLookProgress.market,
        status: progress.status,
        completionPercent: progress.completionPercent,
        missingRequirements: progress.missingRequirements,
        updatedAt: new Date().toISOString(),
      });
      if (updated) onProjectChange(updated);
    },
    [userId, project.id, project.fiveLookProgress.market, onProjectChange]
  );

  const update = useCallback(
    (patch: Partial<MarketLookData>) => {
      if (!data) return;
      const next = { ...data, ...patch };
      setData(next);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void persist(next);
      }, 500);
    },
    [data, persist]
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载看市场结论...
      </div>
    );
  }

  const progress = project.fiveLookProgress.market;
  const selectedSegment = data.selectedOpportunitySegment?.trim() || '';
  const judgement = selectedSegment
    ? `已锁定「${selectedSegment}」作为目标细分市场。`
    : data.attractiveness.trim()
      ? '已有市场总结论，但还没有选择目标细分市场。'
      : '还没有形成可用于机会判断的细分市场结论。';
  const evidence = data.keyEvidences.filter(Boolean);
  const risks = data.risks.filter(Boolean);
  const questions = data.openQuestions.filter(Boolean);

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Market"
        title="看市场 · 细分市场结论"
        judgement={judgement}
        description={data.attractiveness || '看市场只回答一件事：哪些细分市场值得进入，为什么。详细图表和原始指标留在市场工具中。'}
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[progress.status]} · {progress.completionPercent}%
          </span>
        }
        metrics={[
          { label: '目标细分', value: selectedSegment || '未选择', tone: selectedSegment ? 'brand' : 'warn' },
          { label: '商品样本', value: `${marketContext.sampleSize || data.evidence?.sampleSize || 0}`, tone: marketContext.sampleSize ? 'brand' : 'neutral' },
          { label: '历史月份', value: `${marketContext.months?.length || data.evidence?.months?.length || 0}`, tone: marketContext.months?.length ? 'brand' : 'neutral' },
          { label: '市场证据', value: `${evidence.length}`, tone: evidence.length >= 3 ? 'good' : 'neutral' },
        ]}
        sections={[]}
      />

      <SegmentScoreCards
        onOpenMarketTool={onOpenMarketTool ?? (() => {})}
        selectedOpportunitySegment={data.selectedOpportunitySegment}
        onSelectOpportunitySegment={(segment) => update({ selectedOpportunitySegment: segment ?? '' })}
      />

      <Card>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1d1d1f]">
                {selectedSegment ? `${selectedSegment} · 细分结论` : '细分市场详情'}
              </p>
              <p className="text-xs text-[#86868b] mt-0.5">点击上方细分市场卡片后，这里只展示该细分的判断依据。</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
            <SummaryBox title="进入判断" items={data.attractiveness ? [data.attractiveness] : []} emptyText="暂无市场总结论。" />
            <SummaryBox title="关键证据" items={evidence} emptyText="暂无关键证据。" />
            <SummaryBox title="风险 / 待验证" items={[...risks, ...questions]} emptyText="暂无风险或待验证问题。" />
          </div>
        </div>
      </Card>
    </div>
  );
}

function SummaryBox({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <div className="rounded-xl border border-black/5 bg-[#fafafa] p-4 min-h-[140px]">
      <p className="text-xs font-semibold text-[#424245] mb-2">{title}</p>
      {items.length ? (
        <div className="space-y-2">
          {items.map((item, index) => (
            <p key={`${item}-${index}`} className="text-sm text-[#424245] leading-6">
              {item}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#aeaeb2] leading-6">{emptyText}</p>
      )}
    </div>
  );
}
