import { useEffect, useMemo, useState } from 'react';
import { ImageIcon, Loader2, Star } from 'lucide-react';
import { Card, cn } from './ui/Card';
import { FiveLookSummaryShell } from './five-look/FiveLookSummaryShell';
import { loadCompetitorLook, type CompetitorContext, type CompetitorLookData } from '../utils/competitorLook';
import { loadMarketLook, type MarketLookData } from '../utils/marketLook';
import { LOOK_STATUS_LABELS, type ResearchProject } from '../types/researchProject';
import type { Product } from '../utils/parser';

const COMPETITOR_ROLES = ['细分头部', '强力跟随者', '新上架链接'] as const;

export function CompetitorLookView({
  userId,
  project,
  competitorContext,
  products = [],
}: {
  userId: string;
  project: ResearchProject;
  competitorContext: CompetitorContext;
  products?: Product[];
  onProjectChange: (updated: ResearchProject) => void;
  onOpenCompetitorTool?: () => void;
  onNavigateSelf?: () => void;
}) {
  const [data, setData] = useState<CompetitorLookData | null>(null);
  const [marketLook, setMarketLook] = useState<MarketLookData | null>(null);

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

  const productByAsin = useMemo(() => {
    const map = new Map<string, Product>();
    for (const product of products) map.set(product.asin, product);
    return map;
  }, [products]);

  if (!data || !marketLook) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载看竞品结论...
      </div>
    );
  }

  const selectedSegment = marketLook.selectedOpportunitySegment?.trim() || '';
  const slots = [
    data.benchmarkAsins[0] || data.samplePool[0] || '',
    data.benchmarkAsins[1] || data.samplePool[1] || '',
    data.samplePool[2] || data.benchmarkAsins[2] || '',
  ];
  const filledSlots = slots.filter(Boolean).length;
  const gaps = data.gaps.filter(Boolean);
  const productFindings = data.productPowerFindings.filter(Boolean);
  const operationFindings = data.operationPowerFindings.filter(Boolean);
  const judgement = filledSlots === 3
    ? `已形成 ${filledSlots} 列竞品对比，重点看产品力、运营力和未被满足的缝隙。`
    : selectedSegment
      ? `已选择「${selectedSegment}」，还需要补齐头部、跟随者、新链接三类竞品。`
      : '还没有从看市场带入目标细分市场，竞品对比缺少聚焦对象。';
  const progress = project.fiveLookProgress.competitor;

  return (
    <div className="space-y-4">
      <FiveLookSummaryShell
        eyebrow="Five Looks / Competitor"
        title="看竞品 · 三列对比"
        judgement={judgement}
        description="这里只呈现三个竞品的核心对比：图片、价格、Listing 信息、产品力判断、运营力判断和可攻击缝隙。"
        statusBadge={
          <span className="rounded-full border border-black/5 bg-[#f5f5f7] px-2.5 py-1 text-[11px] font-semibold text-[#86868b]">
            {LOOK_STATUS_LABELS[progress.status]} · {progress.completionPercent}%
          </span>
        }
        metrics={[
          { label: '目标细分', value: selectedSegment || '未选择', tone: selectedSegment ? 'brand' : 'warn' },
          { label: '竞品列', value: `${filledSlots}/3`, tone: filledSlots === 3 ? 'good' : 'warn' },
          { label: '产品判断', value: `${productFindings.length}`, tone: productFindings.length ? 'brand' : 'neutral' },
          { label: '运营判断', value: `${operationFindings.length}`, tone: operationFindings.length ? 'brand' : 'neutral' },
        ]}
        sections={[]}
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {slots.map((asin, index) => (
          <CompetitorColumn
            key={`${COMPETITOR_ROLES[index]}-${asin || index}`}
            role={COMPETITOR_ROLES[index]}
            asin={asin}
            product={asin ? productByAsin.get(asin) : undefined}
            productFindings={productFindings}
            operationFindings={operationFindings}
            gaps={gaps}
            fallbackIndex={index}
          />
        ))}
      </div>
    </div>
  );
}

function CompetitorColumn({
  role,
  asin,
  product,
  productFindings,
  operationFindings,
  gaps,
  fallbackIndex,
}: {
  role: string;
  asin: string;
  product?: Product;
  productFindings: string[];
  operationFindings: string[];
  gaps: string[];
  fallbackIndex: number;
}) {
  const productJudgement = productFindings[fallbackIndex] || productFindings[0] || '暂无产品力判断。';
  const operationJudgement = operationFindings[fallbackIndex] || operationFindings[0] || '暂无运营力判断。';
  const gapJudgement = gaps[fallbackIndex] || gaps[0] || '暂无明确可攻击缝隙。';

  return (
    <Card>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-indigo-600">{role}</p>
            <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5">{asin || '待选择 ASIN'}</p>
          </div>
          {product?.rating ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
              <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" /> {product.rating}
            </span>
          ) : null}
        </div>

        <div className="aspect-[4/3] rounded-xl border border-black/5 bg-[#f5f5f7] overflow-hidden flex items-center justify-center">
          {product?.image ? (
            <img src={product.image} alt={product.title || asin} className="w-full h-full object-contain bg-white" />
          ) : (
            <ImageIcon className="w-9 h-9 text-[#c7c7cc]" />
          )}
        </div>

        <div>
          <p className="text-sm font-semibold text-[#1d1d1f] line-clamp-3">
            {product?.title || '暂无 Listing 标题'}
          </p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Metric label="价格" value={product?.price ? `$${product.price.toFixed(2)}` : '-'} />
            <Metric label="月销量" value={product?.monthlySales ? product.monthlySales.toLocaleString() : '-'} />
            <Metric label="月销售额" value={product?.monthlyRevenue ? `$${Math.round(product.monthlyRevenue).toLocaleString()}` : '-'} />
            <Metric label="评论数" value={product?.reviewCount ? product.reviewCount.toLocaleString() : '-'} />
            <Metric label="FBA 费用" value={product?.fbaFee ? `$${product.fbaFee.toFixed(2)}` : '-'} />
            <Metric label="小类 BSR" value={product?.subBsr ? product.subBsr.toLocaleString() : '-'} />
          </div>
        </div>

        <Section title="Listing 信息" items={[
          product?.brand ? `品牌：${product.brand}` : '',
          product?.subCategory ? `类目：${product.subCategory}` : '',
          product?.launchDate ? `上架：${product.launchDate}` : '',
          product?.sellerLocation ? `卖家地：${product.sellerLocation}` : '',
        ].filter(Boolean)} />
        <Section title="产品力判断" items={[productJudgement]} tone="good" />
        <Section title="运营力判断" items={[operationJudgement]} tone="brand" />
        <Section title="可攻击缝隙" items={[gapJudgement]} tone="warn" />
      </div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/5 bg-[#fafafa] px-3 py-2">
      <p className="text-[11px] text-[#86868b]">{label}</p>
      <p className="text-sm font-semibold text-[#1d1d1f] mt-0.5 truncate">{value}</p>
    </div>
  );
}

function Section({
  title,
  items,
  tone = 'neutral',
}: {
  title: string;
  items: string[];
  tone?: 'neutral' | 'good' | 'brand' | 'warn';
}) {
  const toneCls = {
    neutral: 'bg-[#fafafa] border-black/5',
    good: 'bg-emerald-50/70 border-emerald-100',
    brand: 'bg-indigo-50/70 border-indigo-100',
    warn: 'bg-amber-50/70 border-amber-100',
  }[tone];
  return (
    <div className={cn('rounded-xl border p-3', toneCls)}>
      <p className="text-xs font-semibold text-[#424245] mb-1.5">{title}</p>
      {items.length ? (
        items.map((item, index) => (
          <p key={`${item}-${index}`} className="text-xs text-[#424245] leading-5">
            {item}
          </p>
        ))
      ) : (
        <p className="text-xs text-[#aeaeb2] leading-5">暂无数据。</p>
      )}
    </div>
  );
}
