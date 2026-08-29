import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Loader2,
  Wrench,
  Target,
  Users,
  Crosshair,
  UserCog,
  Sparkles,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { ProjectOverviewContent } from './ProjectOverview';
import { SelfAssessmentView } from './SelfAssessmentView';
import { MarketLookView } from './MarketLookView';
import { UserLookView } from './UserLookView';
import { CompetitorLookView } from './CompetitorLookView';
import { OpportunityLookView } from './OpportunityLookView';
import { EditProjectModal } from './EditProjectModal';
import { ProjectMembersModal } from './ProjectMembersModal';
import { setActiveLook } from '../utils/projectStore';
import { syncUserProjectsToCloud } from '../utils/projectCloudAutosync';
import type { MarketContext } from '../utils/marketLook';
import type { UserContext } from '../utils/userLook';
import type { CompetitorContext } from '../utils/competitorLook';
import type { Product } from '../utils/parser';
import {
  FIVE_LOOK_LABELS,
  FIVE_LOOKS,
  LOOK_STATUS_LABELS,
  type FiveLookId,
  type LookStatus,
  type ResearchProject,
} from '../types/researchProject';

type Tab = 'overview' | FiveLookId;

const LOOK_ICONS: Record<FiveLookId, typeof Target> = {
  market: Target,
  user: Users,
  competitor: Crosshair,
  self: UserCog,
  opportunity: Sparkles,
};

const LOOK_STATUS_BADGE: Record<LookStatus, string> = {
  not_started: 'bg-[#f5f5f7] text-[#86868b] border-black/5',
  in_progress: 'bg-amber-50 text-amber-700 border-amber-100',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  stale: 'bg-rose-50 text-rose-700 border-rose-100',
};

const LOOK_STATUS_DOT: Record<LookStatus, string> = {
  not_started: 'bg-[#c7c7cc]',
  in_progress: 'bg-amber-500',
  completed: 'bg-emerald-500',
  stale: 'bg-rose-500',
};

const LOOK_SCOPE: Record<FiveLookId, { question: string; scope: string[]; deliverables: string[] }> = {
  market: {
    question: '这个需求所在的市场，规模、趋势和进入环境如何？',
    scope: ['市场规模、销量与销售额', '月度趋势、同比环比与季节性', '价格带与销量/销售额分布', '品牌、ASIN、卖家集中度', '新品老品结构与上架时间分布', 'BSR、评分、评论与卖家类型分布', '市场风险与异常数据提示', '市场判断报告'],
    deliverables: ['市场吸引力判断', '3–5 条关键证据', '主要市场风险', '对看用户/看竞品的待验证问题'],
  },
  user: {
    question: '用户是谁、在什么场景完成什么任务，哪些需求未被满足？',
    scope: ['关键词分析：搜索量、意图、JTBD、人群/场景/痛点聚类', 'VOC 分析：评论情感、好评差评、期望落差', '用户需求地图（关键词 + VOC 合并）', '未满足需求识别规则'],
    deliverables: ['用户 / 场景 / JTBD 地图', '已满足需求列表', '未满足需求候选列表', '每条需求的证据与强度'],
  },
  competitor: {
    question: '现有竞品如何满足需求，壁垒在哪，为什么仍存在未满足需求？',
    scope: ['产品层：单 ASIN 深度、多 ASIN 对比、Listing/变体/流量词', '竞争主体：品牌、卖家、产品组合、上新节奏', '评论优缺点与看用户需求关联'],
    deliverables: ['竞品样本池与分层', '标杆 ASIN', '产品与经营壁垒', '需求满足矩阵', '未充分满足的产品缺口'],
  },
  self: {
    question: '我们是否具备比现有竞品更好满足该需求的能力与资源？',
    scope: ['目标：销量/收入/利润目标、上市时间、战略意义', '能力：研发、供应链、质量、合规、品牌、广告、运营', '资源：预算、人员、供应商、渠道、素材', '约束：MOQ、交期、认证、现金流、类目限制', '决策边界：最低毛利、最高 CPC、止损条件'],
    deliverables: ['自身优势与可复用资源', '能力缺口', '硬约束与止损边界', '对每张机会卡的自身适配度'],
  },
  opportunity: {
    question: '如何把未满足需求转化为可比较、可验证、可决策的机会？',
    scope: ['机会卡：以未满足需求为起点', '机会评分（需求强度/市场价值/竞品缺口/自身适配/商业可行性）', '机会优先级矩阵与对比', '最终决策摘要'],
    deliverables: ['机会卡列表', '机会优先级矩阵', '机会对比', '最终决策摘要'],
  },
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_HINT: Record<SaveState, { text: string; cls: string; icon: typeof Circle }> = {
  idle: { text: '已保存', cls: 'text-[#aeaeb2]', icon: CheckCircle2 },
  saving: { text: '保存中…', cls: 'text-amber-600', icon: Loader2 },
  saved: { text: '已保存', cls: 'text-emerald-600', icon: CheckCircle2 },
  error: { text: '保存失败，点击重试', cls: 'text-rose-600', icon: AlertTriangle },
};

export function ProjectWorkspace({
  userId,
  project,
  username,
  marketContext,
  userContext,
  competitorContext,
  products = [],
  onBack,
  onOpenTool,
  onProjectChange,
}: {
  userId: string;
  project: ResearchProject;
  username: string;
  marketContext: MarketContext;
  userContext: UserContext;
  competitorContext: CompetitorContext;
  products?: Product[];
  onBack: () => void;
  onOpenTool: (view: 'market' | 'competitors' | 'insights' | 'keywords' | 'profit') => void;
  onProjectChange: (updated: ResearchProject) => void;
}) {
  const [p, setP] = useState<ResearchProject>(project);
  const [tab, setTab] = useState<Tab>(project.activeLook);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [editOpen, setEditOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const initialSyncKey = useRef(`${project.id}:${project.version}:${project.updatedAt}`);
  const lastQueuedSyncKey = useRef(initialSyncKey.current);

  const queueCloudSync = () => {
    lastQueuedSyncKey.current = '';
    void syncUserProjectsToCloud(userId);
  };

  useEffect(() => {
    const syncKey = `${p.id}:${p.version}:${p.updatedAt}`;
    if (syncKey === initialSyncKey.current || syncKey === lastQueuedSyncKey.current) return;
    lastQueuedSyncKey.current = syncKey;
    const timer = window.setTimeout(() => {
      void syncUserProjectsToCloud(userId);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [p.id, p.version, p.updatedAt, userId]);

  const applyProjectUpdate = (updated: ResearchProject) => {
    setP(updated);
    onProjectChange(updated);
  };

  const switchToLook = async (look: FiveLookId) => {
    setTab(look);
    if (p.activeLook === look) return;
    setSaveState('saving');
    try {
      const updated = await setActiveLook(userId, p.id, look);
      if (updated) {
        applyProjectUpdate(updated);
        setSaveState('saved');
      } else {
        setSaveState('error');
        toast.error('保存工作位置失败');
      }
    } catch {
      setSaveState('error');
      toast.error('保存工作位置失败');
    }
  };

  const retrySave = async () => {
    setSaveState('saving');
    try {
      const updated = await setActiveLook(userId, p.id, tab as FiveLookId);
      if (updated) {
        applyProjectUpdate(updated);
        setSaveState('saved');
      } else {
        setSaveState('error');
      }
    } catch {
      setSaveState('error');
    }
  };

  const toolButtons: { label: string; view: 'market' | 'competitors' | 'insights' | 'keywords' | 'profit' }[] =
    tab === 'market'
      ? [{ label: '打开市场大盘工具', view: 'market' }]
      : tab === 'user'
        ? [{ label: '打开关键词工具', view: 'keywords' }, { label: '打开评论 / VOC 工具', view: 'insights' }]
        : tab === 'competitor'
          ? [{ label: '打开竞品对比工具', view: 'competitors' }]
          : tab === 'self'
            ? [{ label: '打开利润计算器', view: 'profit' }]
            : [];
  const hint = SAVE_HINT[saveState];
  const HintIcon = hint.icon;

  return (
    <div className="max-w-6xl mx-auto w-full">
      {/* 顶部：返回 + 项目名 + 保存状态 */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="mt-1 shrink-0 w-8 h-8 rounded-xl border border-black/8 bg-white text-[#86868b] hover:text-indigo-600 hover:border-indigo-200 transition-all flex items-center justify-center"
            title="返回项目中心"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-[#1d1d1f] truncate">{p.name}</h2>
              <button type="button" onClick={() => setEditOpen(true)} title="编辑项目" className="shrink-0 w-7 h-7 rounded-lg hover:bg-[#f5f5f7] flex items-center justify-center text-[#aeaeb2] hover:text-indigo-600 transition-colors">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setMembersOpen(true)} title="项目成员" className="shrink-0 w-7 h-7 rounded-lg hover:bg-[#f5f5f7] flex items-center justify-center text-[#aeaeb2] hover:text-indigo-600 transition-colors">
                <Users className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-sm text-[#86868b] mt-0.5">{p.marketplace} · {p.objective || '未设置目标'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={saveState === 'error' ? retrySave : undefined}
          className={cn('inline-flex items-center gap-1.5 text-xs font-medium shrink-0 mt-1', hint.cls)}
        >
          <HintIcon className={cn('w-3.5 h-3.5', saveState === 'saving' && 'animate-spin')} />
          {hint.text}
        </button>
      </div>

      {/* 打开对应的分析工具（工具仍在全局工作区，通过项目入口进入） */}
      {false && toolButtons.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {toolButtons.map((b) => (
            <button
              key={b.view}
              type="button"
              onClick={() => onOpenTool(b.view)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-indigo-100 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:border-indigo-200 transition-all active:scale-[0.98]"
            >
              <Wrench className="w-3.5 h-3.5" />
              {b.label}
            </button>
          ))}
        </div>
      )}

      {/* 非线性五看 Tab（任意顺序进入） */}
      <div className="flex flex-wrap items-center gap-1.5 mb-5 border-b border-black/5 pb-3">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} label="概览" />
        {FIVE_LOOKS.map((look) => {
          const Icon = LOOK_ICONS[look];
          const s = p.fiveLookProgress[look].status;
          return (
            <TabButton
              key={look}
              active={tab === look}
              onClick={() => void switchToLook(look)}
              label={FIVE_LOOK_LABELS[look]}
              icon={<Icon className="w-3.5 h-3.5" />}
              dot={<span className={cn('w-1.5 h-1.5 rounded-full', LOOK_STATUS_DOT[s])} />}
            />
          );
        })}
      </div>

      {/* 内容区 */}
      {tab === 'overview' ? (
        <ProjectOverviewContent project={p} username={username} userId={userId} onNavigateLook={(look) => void switchToLook(look)} />
      ) : tab === 'self' ? (
        <SelfAssessmentView
          userId={userId}
          project={p}
          onProjectChange={applyProjectUpdate}
          onNavigateOpportunity={() => void switchToLook('opportunity')}
        />
      ) : tab === 'market' ? (
        <MarketLookView
          userId={userId}
          project={p}
          marketContext={marketContext}
          onProjectChange={applyProjectUpdate}
          onOpenMarketTool={() => onOpenTool('market')}
          onNavigateCompetitor={() => void switchToLook('competitor')}
        />
      ) : tab === 'user' ? (
        <UserLookView
          userId={userId}
          project={p}
          userContext={userContext}
          onProjectChange={applyProjectUpdate}
          onOpenKeywordTool={() => onOpenTool('keywords')}
          onOpenVocTool={() => onOpenTool('insights')}
          onNavigateMarket={() => void switchToLook('market')}
        />
      ) : tab === 'competitor' ? (
        <CompetitorLookView
          userId={userId}
          project={p}
          competitorContext={competitorContext}
          products={products}
          onProjectChange={applyProjectUpdate}
          onOpenCompetitorTool={() => onOpenTool('competitors')}
          onNavigateSelf={() => void switchToLook('self')}
        />
      ) : (
        <OpportunityLookView userId={userId} project={p} onProjectChange={applyProjectUpdate} onNavigateLook={(look) => void switchToLook(look)} />
      )}
      {editOpen && (
        <EditProjectModal
          userId={userId}
          project={p}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setEditOpen(false);
            applyProjectUpdate(updated);
          }}
        />
      )}
      {membersOpen && (
        <ProjectMembersModal
          projectId={p.id}
          currentUserId={userId}
          onClose={() => setMembersOpen(false)}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon,
  dot,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: ReactNode;
  dot?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-all',
        active
          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-200'
          : 'bg-white text-[#86868b] border-black/8 hover:text-indigo-600 hover:border-indigo-200'
      )}
    >
      {icon}
      {label}
      {dot}
    </button>
  );
}

function LookWorkspacePlaceholder({ project, look }: { project: ResearchProject; look: FiveLookId }) {
  const progress = project.fiveLookProgress[look];
  const scope = LOOK_SCOPE[look];
  const Icon = LOOK_ICONS[look];

  return (
    <div className="space-y-5">
      {/* 视角头 */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
            <Icon className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-[#1d1d1f]">{FIVE_LOOK_LABELS[look]}</h3>
            <p className="text-sm text-[#86868b]">{scope.question}</p>
          </div>
        </div>
        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold border', LOOK_STATUS_BADGE[progress.status])}>
          {LOOK_STATUS_LABELS[progress.status]} · {progress.completionPercent}%
        </span>
      </div>

      {/* 范围与产物 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="p-5">
            <p className="text-xs font-semibold text-[#424245] mb-3">本视角将覆盖</p>
            <ul className="space-y-2">
              {scope.scope.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#424245]">
                  <span className="mt-1.5 w-1 h-1 rounded-full bg-[#c7c7cc] shrink-0" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card>
          <div className="p-5">
            <p className="text-xs font-semibold text-[#424245] mb-3">完成产物</p>
            <ul className="space-y-2">
              {scope.deliverables.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#424245]">
                  <Circle className="w-4 h-4 text-[#c7c7cc] mt-0.5 shrink-0" />
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      {/* 待复核提示 */}
      {progress.staleReasons.length > 0 && (
        <Card className="border-rose-100 bg-rose-50/50">
          <div className="p-5 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-rose-700">需要复核</p>
              <ul className="mt-1 space-y-1">
                {progress.staleReasons.map((r, i) => (
                  <li key={i} className="text-xs text-rose-600">· {r}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* M3 占位 */}
      <Card className="border-dashed">
        <div className="p-8 text-center">
          <div className="mx-auto w-12 h-12 bg-[#f5f5f7] rounded-full flex items-center justify-center mb-3">
            <Wrench className="w-5 h-5 text-[#c7c7cc]" />
          </div>
          <p className="text-sm font-semibold text-[#424245]">工具接入中（Phase 1 M3）</p>
          <p className="text-sm text-[#86868b] mt-1 max-w-md mx-auto leading-relaxed">
            该视角将复用现有「市场大盘 / 关键词+VOC / 竞品对比 / 利润计算器」能力，并挂到当前项目上下文。当前为骨架占位。
          </p>
        </div>
      </Card>
    </div>
  );
}
