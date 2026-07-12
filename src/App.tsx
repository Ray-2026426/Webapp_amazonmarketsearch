import React, { useState, useMemo, useCallback, useEffect, useRef, ReactNode } from 'react';
import { BarChart3, TrendingUp, Package, DollarSign, Users, LayoutDashboard, Settings, Loader2, Star, MessageCircle, Activity, Store, Scale, Box, MapPin, Filter, Layers, Calculator, X, Sparkles, Trash2, Trophy, History, Printer, CheckSquare } from 'lucide-react';
import { MetricCard } from './components/MetricCard';
import { MarketTrendChart } from './components/MarketTrendChart';
import { PriceDistributionChart } from './components/PriceDistributionChart';
import { SellerTypeChart } from './components/SellerTypeChart';
import { BrandLeaderboard } from './components/BrandLeaderboard';
import { TopProductsTable } from './components/TopProductsTable';
import { LaunchDateChart } from './components/LaunchDateChart';
import { NewVsOldChart } from './components/NewVsOldChart';
import { RatingDistributionChart } from './components/RatingDistributionChart';
import { SellerLocationChart } from './components/SellerLocationChart';
import { SegmentShareChart } from './components/SegmentShareChart';
import { FileUpload } from './components/FileUpload';
import { DateRangeSelector } from './components/DateRangeSelector';
import { SegmentationManager } from './components/SegmentationManager';
import { UserInsights } from './components/UserInsights';
import { KeywordAnalysis } from './components/KeywordAnalysis';
import { ProfitCalculator } from './components/ProfitCalculator';
import { MarketAnalysisReport } from './components/MarketAnalysisReport';
import { MarketHistoryModal } from './components/MarketHistoryModal';
import { saveMarketSnapshot, suggestMarketSnapshotTitle, type MarketHistorySnapshot } from './utils/marketHistory';
import { clearWorkspaceIndexedDb } from './utils/workspaceIdb';
import { parseProducts, parseHistory, detectMarketplaceFromFile, Product, HistoryRecord, Review, Keyword, getCurrencySymbol, formatRevenue, computeMarketReportFingerprint } from './utils/parser';
import { get, set, del } from 'idb-keyval';
import { Toaster, toast } from 'sonner';
import { getCurrentUser, logout, type SessionUser } from './utils/auth';
import { loadAiSettings, saveAiSettings, AiSettings } from './utils/aiConfig';
import { LoginPage } from './components/LoginPage';
import { AiSettingsPanel } from './components/AiSettingsPanel';
import { savePromptItem, resetPromptToDefault } from './components/AiPromptManager';
import { OpportunityScanner } from './components/OpportunityScanner';
import { SeasonalHeatmap } from './components/SeasonalHeatmap';
import { BsrDistributionChart } from './components/BsrDistributionChart';
import { PriceRatingChart } from './components/PriceRatingChart';
import { MarketConcentrationChart } from './components/MarketConcentrationChart';
import { AvatarSettingsModal } from './components/AvatarSettingsModal';
import { AnchorAnnotationsLayer } from './components/AnchorAnnotationsLayer';
import type { AnchorAnnotation } from './utils/anchorAnnotations';
import { normalizeAnchorAnnotations } from './utils/anchorAnnotations';
import { MarketScorecard } from './components/MarketScorecard';
import { PageQuickNav } from './components/PageQuickNav';
import { AsinCompareBar } from './components/AsinCompareBar';
import {
  makeLevel2Key,
  makeLevel3Key,
  parseSegmentPathKey,
  formatSegmentLabel,
  inferSegmentDepth,
  productMatchesSegmentFilter,
  coerceSegmentFilterKey,
  type SegmentDepth,
} from './utils/subSegments';
interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage?: string;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, errorMessage: error.message + '\n' + error.stack };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorMessage: error.message + '\n' + error.stack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#f5f5f7] flex flex-col items-center justify-center p-8 text-center">
          <div className="bg-white p-12 rounded-[32px] shadow-xl max-w-2xl border border-black/5">
            <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Activity className="w-10 h-10 text-rose-500" />
            </div>
            <h2 className="text-2xl font-bold text-[#1d1d1f] mb-4">抱歉，应用遇到了错误</h2>
            <p className="text-[#86868b] mb-4 leading-relaxed">由于数据量过大或系统异常，应用暂时无法继续运行。点击下方仅清空当前工作区数据，不会删除您的登录账号与市场历史。</p>
            {this.state.errorMessage && (
              <pre className="text-left text-xs bg-[#f5f5f7] rounded-xl p-4 mb-6 overflow-auto max-h-48 text-rose-600 border border-rose-100">{this.state.errorMessage}</pre>
            )}
            <button 
              onClick={async () => {
                try {
                  await clearWorkspaceIndexedDb();
                } catch (e) {
                  console.error("Failed to clear workspace IDB in ErrorBoundary:", e);
                }
                window.dispatchEvent(new CustomEvent('reset-app'));
                this.setState({ hasError: false });
              }}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-semibold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
            >
              重置应用
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  // ── Auth & AI Settings ────────────────────────────────────────────────────
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(() => getCurrentUser());
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(() => loadAiSettings());
  const [isAiSettingsOpen, setIsAiSettingsOpen] = useState(false);
  const [isAvatarSettingsOpen, setIsAvatarSettingsOpen] = useState(false);

  const handleLoginSuccess = useCallback(() => {
    const isGuest = sessionStorage.getItem('guest_mode') === '1';
    if (!isGuest) {
      setCurrentUser(getCurrentUser());
      setAiSettings(loadAiSettings());
    } else {
      // Guest mode: set a dummy user
      setCurrentUser({ id: 'guest', username: '游客' });
    }
  }, []);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem('guest_mode');
    logout();
    setCurrentUser(null);
  }, []);

  const handleSaveAiSettings = useCallback((settings: AiSettings) => {
    saveAiSettings(settings);
    setAiSettings(settings);
  }, []);

  // ── Data ──────────────────────────────────────────────────────────────────
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  
  const [selectedKpiMonths, setSelectedKpiMonths] = useState<string[]>([]);
  const [previousKpiMonths, setPreviousKpiMonths] = useState<string[]>([]);
  const [lastYearKpiMonths, setLastYearKpiMonths] = useState<string[]>([]);
  
  const [marketplace, setMarketplace] = useState<{ code: string, domain: string }>({ code: 'US', domain: 'amazon.com' });
  /** 历史上传文件名，用于保存快照默认名「站点-文件名」 */
  const [historySourceLabel, setHistorySourceLabel] = useState('');

  // Segmentation State
  const [segments, setSegments] = useState<string[]>([]);
  const [asinToSegment, setAsinToSegment] = useState<Record<string, string>>({});
  const [segmentChildren, setSegmentChildren] = useState<Record<string, string[]>>({});
  const [asinToSubSegment, setAsinToSubSegment] = useState<Record<string, string>>({});
  const [segmentDescriptions, setSegmentDescriptions] = useState<Record<string, { people: string, scenarios: string, needs: string }>>({});
  const [segmentSubDescriptions, setSegmentSubDescriptions] = useState<Record<string, { people: string, scenarios: string, needs: string }>>({});
  const [segmentDepth, setSegmentDepth] = useState<SegmentDepth>(1);
  const [segmentLevel3Children, setSegmentLevel3Children] = useState<Record<string, string[]>>({});
  const [asinToLevel3Segment, setAsinToLevel3Segment] = useState<Record<string, string>>({});
  const [segmentLevel3Descriptions, setSegmentLevel3Descriptions] = useState<Record<string, { people: string, scenarios: string, needs: string }>>({});
  const [selectedSegment, setSelectedSegment] = useState<string>('all');
  const [isSegmentationOpen, setIsSegmentationOpen] = useState(false);
  const [isSegAiRunning, setIsSegAiRunning] = useState(false);
  const handleCloseSegmentation = React.useCallback(() => {
    setIsSegmentationOpen(false);
  }, []);

  const [activeView, setActiveView] = useState<'market' | 'insights' | 'keywords' | 'profit'>('market');
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isReportHidden, setIsReportHidden] = useState(false);
  const [isMarketHistoryOpen, setIsMarketHistoryOpen] = useState(false);
  /** 与当前数据指纹一致时复用，避免重复请求 AI */
  const [marketReportCache, setMarketReportCache] = useState<{ fingerprint: string; body: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: 'reupload' | 'reset', message: string } | null>(null);

  const reportDataFingerprint = useMemo(
    () => computeMarketReportFingerprint(
      products,
      segments,
      asinToSegment,
      segmentDescriptions,
      segmentChildren,
      asinToSubSegment,
      segmentSubDescriptions,
      segmentLevel3Children,
      asinToLevel3Segment,
      segmentLevel3Descriptions,
      segmentDepth
    ),
    [products, segments, asinToSegment, segmentDescriptions, segmentChildren, asinToSubSegment, segmentSubDescriptions, segmentLevel3Children, asinToLevel3Segment, segmentLevel3Descriptions, segmentDepth]
  );

  const handlePersistMarketReport = useCallback((body: string) => {
    setMarketReportCache({ fingerprint: reportDataFingerprint, body });
  }, [reportDataFingerprint]);

  const openMarketReport = useCallback(() => {
    setIsReportOpen(true);
    setIsReportHidden(false);
  }, []);

  const hideMarketReport = useCallback(() => {
    setIsReportHidden(true);
  }, []);

  const closeMarketReport = useCallback(() => {
    setIsReportOpen(false);
    setIsReportHidden(false);
  }, []);

  // User Insights State
  const [reviews, setReviews] = useState<Review[]>([]);
  const [persona, setPersona] = useState<{ people: string; scenarios: string; needs: string } | null>(null);

  // Keyword Analysis State
  const [keywords, setKeywords] = useState<Keyword[]>([]);

  /** 主内容滚动区 ref，供锚点批注绑定滚动与点击捕获 */
  const scrollMainRef = useRef<HTMLDivElement>(null);
  /** 锚点批注列表（随 IndexedDB / 市场快照持久化） */
  const [anchorAnnotations, setAnchorAnnotations] = useState<AnchorAnnotation[]>([]);
  /** 是否打开「点页面添加批注」模式 */
  const [annotateMode, setAnnotateMode] = useState(false);
  const [selectedCompareAsins, setSelectedCompareAsins] = useState<string[]>([]);

  const isRegisteredUser = Boolean(currentUser && currentUser.id !== 'guest');

  const toggleCompareAsin = useCallback((asin: string) => {
    setSelectedCompareAsins(prev =>
      prev.includes(asin) ? prev.filter(a => a !== asin) : prev.length < 5 ? [...prev, asin] : prev
    );
  }, []);

  const applyMarketSnapshotFromHistory = useCallback(async (snap: MarketHistorySnapshot) => {
    setIsLoading(true);
    try {
      await set('products', snap.products);
      await set('history', snap.history);
      await set('months', snap.months);
      await set('marketplace', snap.marketplace);
      await set('isDataLoaded', true);
      await set('segments', snap.segments);
      await set('asinToSegment', snap.asinToSegment);
      await set('segmentChildren', snap.segmentChildren ?? {});
      await set('asinToSubSegment', snap.asinToSubSegment ?? {});
      await set('segmentDescriptions', snap.segmentDescriptions);
      await set('segmentSubDescriptions', snap.segmentSubDescriptions ?? {});
      await set('segmentDepth', snap.segmentDepth ?? inferSegmentDepth(snap.segmentChildren ?? {}, snap.asinToSubSegment ?? {}, snap.segmentLevel3Children ?? {}, snap.asinToLevel3Segment ?? {}));
      await set('segmentLevel3Children', snap.segmentLevel3Children ?? {});
      await set('asinToLevel3Segment', snap.asinToLevel3Segment ?? {});
      await set('segmentLevel3Descriptions', snap.segmentLevel3Descriptions ?? {});
      await set('selectedSegment', snap.selectedSegment);
      await set('reviews', snap.reviews);
      await set('persona', snap.persona);
      await set('keywords', snap.keywords);
      await set('marketReportCache', snap.marketReportCache);
      await set('activeView', snap.activeView);
      await set('historySourceLabel', snap.historySourceLabel ?? '');
      await set('anchorAnnotations', normalizeAnchorAnnotations(snap.anchorAnnotations));

      setMarketplace(snap.marketplace);
      setProducts(snap.products);
      setHistory(snap.history);
      setMonths(snap.months);
      setSegments(snap.segments);
      setAsinToSegment(snap.asinToSegment);
      setSegmentChildren(snap.segmentChildren ?? {});
      setAsinToSubSegment(snap.asinToSubSegment ?? {});
      setSegmentDescriptions(snap.segmentDescriptions);
      setSegmentSubDescriptions(snap.segmentSubDescriptions ?? {});
      const restoredDepth = snap.segmentDepth ?? inferSegmentDepth(snap.segmentChildren ?? {}, snap.asinToSubSegment ?? {}, snap.segmentLevel3Children ?? {}, snap.asinToLevel3Segment ?? {});
      setSegmentDepth(restoredDepth);
      setSegmentLevel3Children(snap.segmentLevel3Children ?? {});
      setAsinToLevel3Segment(snap.asinToLevel3Segment ?? {});
      setSegmentLevel3Descriptions(snap.segmentLevel3Descriptions ?? {});
      setSelectedSegment(coerceSegmentFilterKey(snap.selectedSegment, restoredDepth));
      setSelectedKpiMonths(snap.selectedKpiMonths);
      setPreviousKpiMonths(snap.previousKpiMonths);
      setLastYearKpiMonths(snap.lastYearKpiMonths);
      setReviews(snap.reviews);
      setPersona(snap.persona);
      setKeywords(snap.keywords);
      setMarketReportCache(snap.marketReportCache);
      setActiveView(snap.activeView);
      setHistorySourceLabel(snap.historySourceLabel ?? '');
      setAnchorAnnotations(normalizeAnchorAnnotations(snap.anchorAnnotations));
      setAnnotateMode(false);
      setIsDataLoaded(true);
      toast.success(`已打开历史市场：${snap.meta.title}`);
    } catch (e) {
      console.error(e);
      toast.error('打开历史市场失败，请重试');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSaveMarketToHistory = useCallback(async () => {
    if (!isRegisteredUser || !currentUser) {
      toast.error('请使用注册账号登录后再保存历史（游客模式不可用）');
      return;
    }
    const suggested = suggestMarketSnapshotTitle(marketplace.code, historySourceLabel || undefined, products);
    const name = window.prompt('为这条市场命名（可留空则使用建议名称）', suggested);
    if (name === null) return;
    const finalTitle = name.trim() || suggested;
    toast.info('正在保存到本机…');
    const res = await saveMarketSnapshot(currentUser.id, {
      title: finalTitle,
      historySourceLabel: historySourceLabel || undefined,
      marketplace,
      products,
      history,
      months,
      segments,
      asinToSegment,
      segmentChildren,
      asinToSubSegment,
      segmentDescriptions,
      segmentSubDescriptions,
      segmentDepth,
      segmentLevel3Children,
      asinToLevel3Segment,
      segmentLevel3Descriptions,
      selectedSegment,
      selectedKpiMonths,
      previousKpiMonths,
      lastYearKpiMonths,
      reviews,
      persona,
      keywords,
      marketReportCache,
      activeView,
      anchorAnnotations,
    });
    if ('error' in res) {
      toast.error(res.error);
      return;
    }
    toast.success('已保存到我的市场历史（存在本机浏览器）');
  }, [
    isRegisteredUser,
    currentUser,
    marketplace,
    products,
    history,
    months,
    segments,
    asinToSegment,
    segmentChildren,
    asinToSubSegment,
    segmentDescriptions,
    segmentSubDescriptions,
    segmentDepth,
    segmentLevel3Children,
    asinToLevel3Segment,
    segmentLevel3Descriptions,
    selectedSegment,
    selectedKpiMonths,
    previousKpiMonths,
    lastYearKpiMonths,
    reviews,
    persona,
    keywords,
    marketReportCache,
    activeView,
    historySourceLabel,
    anchorAnnotations,
  ]);

  const handleExportPdf = useCallback(() => {
    document.body.classList.add('app-print-export');
    let cleared = false;
    const cleanup = () => {
      if (cleared) return;
      cleared = true;
      window.clearTimeout(fallback);
      document.body.classList.remove('app-print-export');
      window.removeEventListener('afterprint', cleanup);
    };
    const fallback = window.setTimeout(cleanup, 120000);
    window.addEventListener('afterprint', cleanup);
    toast.info(
      '请在打印窗口将「目标打印机」选为「另存为 PDF」或 Microsoft Print to PDF；建议勾选「背景图形」以保留配色。',
      { duration: 9000 }
    );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, []);

  // Persistence Logic
  const [isInitializing, setIsInitializing] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleReupload = () => {
    setConfirmAction({
      action: 'reupload',
      message: '确定要重新上传数据吗？当前已加载的数据将被覆盖。'
    });
  };

  const resetAppState = useCallback(async (fullReset = true) => {
    // 1. Immediately stop any data-dependent logic and show loading if needed
    setIsDataLoaded(false);
    
    // 2. Reset all data states
    setProducts([]);
    setHistory([]);
    setMonths([]);
    setReviews([]);
    setKeywords([]);
    setAsinToSegment({});
    setSegmentChildren({});
    setAsinToSubSegment({});
    setSegments([]);
    setSegmentDescriptions({});
    setSegmentSubDescriptions({});
    setSelectedSegment('all');
    setPersona(null);
    setMarketReportCache(null);
    setHistorySourceLabel('');
    setAnchorAnnotations([]);
    setAnnotateMode(false);
    
    // 3. Reset KPI selections
    setSelectedKpiMonths([]);
    setPreviousKpiMonths([]);
    setLastYearKpiMonths([]);
    
    // 4. Reset UI states
    setActiveView('market');
    closeMarketReport();
    setIsSegmentationOpen(false);
    
    // 5. Reset settings if it's a full reset
    if (fullReset) {
      setMarketplace({ code: 'US', domain: 'amazon.com' });
      resetPromptToDefault('segmentation');
    }
    
    // 6. 仅清空工作区键，保留「我的市场历史」等按账号存储的快照
    try {
      await clearWorkspaceIndexedDb();
      console.log("Workspace IndexedDB keys cleared.");
    } catch (err) {
      console.error("Failed to clear workspace IndexedDB:", err);
    }
    
    // 7. Clear confirmation dialog
    setConfirmAction(null);
    
    // 8. Visual feedback
    toast.info(fullReset ? "应用已完全重置" : "数据已清除，您可以重新上传数据。");
  }, [closeMarketReport]);

  const executeReupload = () => {
    const isFullReset = confirmAction?.action === 'reset';
    // Use setTimeout to ensure the state update is clean and doesn't conflict with the modal closing
    setTimeout(() => {
      resetAppState(isFullReset);
    }, 0);
  };

  // Error logging and mount tracking for debugging
  useEffect(() => {
    const mountTime = new Date().toISOString();
    const mountCount = parseInt(localStorage.getItem('mount_count') || '0', 10) + 1;
    localStorage.setItem('mount_count', mountCount.toString());
    localStorage.setItem('last_mount_time', mountTime);
    console.log(`App mounted. Count: ${mountCount}, Time: ${mountTime}`);

    const handleResetEvent = () => {
      console.log("Received reset-app event. Resetting state...");
      resetAppState();
    };
    window.addEventListener('reset-app', handleResetEvent);

    const handleError = (e: ErrorEvent) => {
      console.error('Global Error Detected:', e.message, e.error);
      const errors = JSON.parse(localStorage.getItem('app_errors') || '[]');
      errors.push({ 
        message: e.message, 
        stack: e.error?.stack,
        time: new Date().toISOString() 
      });
      localStorage.setItem('app_errors', JSON.stringify(errors.slice(-10)));
    };
    window.addEventListener('error', handleError);
    return () => {
      window.removeEventListener('reset-app', handleResetEvent);
      window.removeEventListener('error', handleError);
    };
  }, [resetAppState]);

  useEffect(() => {
    console.log("App mounted");
  }, []);

  // Load state from IndexedDB on mount
  useEffect(() => {
    const loadState = async () => {
      console.log("Initializing app state from IndexedDB...");
      setIsRestoring(true);
      try {
        // Load settings first
        const [
          savedMarketplace, savedSegmentationPrompt, savedActiveView, savedIsDataLoaded
        ] = await Promise.all([
          get('marketplace'), get('segmentationPrompt'), get('activeView'), get('isDataLoaded')
        ]);

        if (savedMarketplace) setMarketplace(savedMarketplace);
        if (savedSegmentationPrompt != null && String(savedSegmentationPrompt).trim() !== '') {
          savePromptItem('segmentation', String(savedSegmentationPrompt));
          await del('segmentationPrompt');
        }
        if (savedActiveView) setActiveView(savedActiveView);
        
        // If data was loaded before, try to restore it sequentially to avoid OOM
        if (savedIsDataLoaded) {
          console.log("Restoring heavy data from IDB...");
          
          const savedProducts = await get('products');
          if (savedProducts && savedProducts.length > 0) {
            setProducts(savedProducts);
            
            // Load other data only if products exist
            const [
              savedHistory, savedMonths, savedSegments,
              savedAsinToSegment, savedSegmentChildren, savedAsinToSubSegment, savedSegmentDescriptions, savedSegmentSubDescriptions,
              savedSegmentDepth, savedSegmentLevel3Children, savedAsinToLevel3Segment, savedSegmentLevel3Descriptions,
              savedReviews, savedPersona, savedKeywords, savedSelectedSegment,
              savedMarketReportCache, savedHistorySourceLabel, savedAnchorAnnotations,
              savedSelectedKpiMonths, savedPreviousKpiMonths, savedLastYearKpiMonths,
            ] = await Promise.all([
              get('history'), get('months'), get('segments'),
              get('asinToSegment'), get('segmentChildren'), get('asinToSubSegment'), get('segmentDescriptions'), get('segmentSubDescriptions'),
              get('segmentDepth'), get('segmentLevel3Children'), get('asinToLevel3Segment'), get('segmentLevel3Descriptions'),
              get('reviews'), get('persona'), get('keywords'), get('selectedSegment'),
              get('marketReportCache'),
              get('historySourceLabel'),
              get('anchorAnnotations'),
              get('selectedKpiMonths'),
              get('previousKpiMonths'),
              get('lastYearKpiMonths'),
            ]);

            if (savedHistory) setHistory(savedHistory);
            if (savedMonths) setMonths(savedMonths);
            if (savedSegments) setSegments(savedSegments);
            if (savedAsinToSegment) setAsinToSegment(savedAsinToSegment);
            if (savedSegmentChildren) setSegmentChildren(savedSegmentChildren);
            if (savedAsinToSubSegment) setAsinToSubSegment(savedAsinToSubSegment);
            if (savedSegmentDescriptions) setSegmentDescriptions(savedSegmentDescriptions);
            if (savedSegmentSubDescriptions) setSegmentSubDescriptions(savedSegmentSubDescriptions);
            const loadedChildren = savedSegmentChildren || {};
            const loadedSub = savedAsinToSubSegment || {};
            const loadedL3Children = savedSegmentLevel3Children || {};
            const loadedL3Tags = savedAsinToLevel3Segment || {};
            const loadedDepth = (typeof savedSegmentDepth === 'number' && [1, 2, 3].includes(savedSegmentDepth))
              ? (savedSegmentDepth as SegmentDepth)
              : inferSegmentDepth(loadedChildren, loadedSub, loadedL3Children, loadedL3Tags);
            setSegmentDepth(loadedDepth);
            if (savedSegmentLevel3Children) setSegmentLevel3Children(savedSegmentLevel3Children);
            if (savedAsinToLevel3Segment) setAsinToLevel3Segment(savedAsinToLevel3Segment);
            if (savedSegmentLevel3Descriptions) setSegmentLevel3Descriptions(savedSegmentLevel3Descriptions);
            if (savedReviews) setReviews(savedReviews);
            if (savedPersona) setPersona(savedPersona);
            if (savedKeywords) setKeywords(savedKeywords);
            if (savedSelectedSegment) {
              setSelectedSegment(coerceSegmentFilterKey(String(savedSelectedSegment), loadedDepth));
            }
            if (
              savedMarketReportCache &&
              typeof savedMarketReportCache === 'object' &&
              typeof (savedMarketReportCache as { fingerprint?: string }).fingerprint === 'string' &&
              typeof (savedMarketReportCache as { body?: string }).body === 'string'
            ) {
              setMarketReportCache(savedMarketReportCache as { fingerprint: string; body: string });
            }
            if (typeof savedHistorySourceLabel === 'string') {
              setHistorySourceLabel(savedHistorySourceLabel);
            }
            setAnchorAnnotations(normalizeAnchorAnnotations(savedAnchorAnnotations));

            const validMonthSubset = (arr: unknown, available: string[]): arr is string[] =>
              Array.isArray(arr) &&
              arr.length > 0 &&
              arr.every((x) => typeof x === 'string' && available.includes(x));
            if (savedMonths && Array.isArray(savedMonths) && savedMonths.length > 0) {
              const available = savedMonths as string[];
              if (validMonthSubset(savedSelectedKpiMonths, available))
                setSelectedKpiMonths(savedSelectedKpiMonths);
              if (validMonthSubset(savedPreviousKpiMonths, available))
                setPreviousKpiMonths(savedPreviousKpiMonths);
              if (validMonthSubset(savedLastYearKpiMonths, available))
                setLastYearKpiMonths(savedLastYearKpiMonths);
            }
            
            setIsDataLoaded(true);
            console.log("App state restored successfully.");
          }
        } else {
          // 未加载市场数据时，仍恢复已保存的评论等工作区内容（仅评论分析）
          const [savedReviews, savedPersona, savedKeywords, savedAnchorAnnotations] = await Promise.all([
            get('reviews'),
            get('persona'),
            get('keywords'),
            get('anchorAnnotations'),
          ]);
          if (savedReviews && Array.isArray(savedReviews) && savedReviews.length > 0) {
            setReviews(savedReviews);
            if (savedPersona) setPersona(savedPersona);
            if (savedKeywords) setKeywords(savedKeywords);
            setAnchorAnnotations(normalizeAnchorAnnotations(savedAnchorAnnotations));
            console.log('Restored reviews-only workspace from IDB.');
          }
        }
      } catch (error) {
        console.error("Failed to load state from IndexedDB:", error);
      } finally {
        setIsInitializing(false);
        setIsRestoring(false);
      }
    };
    loadState();
  }, []);

  // 数据与缓存指纹不一致时丢弃过期报告（避免展示错误内容）
  useEffect(() => {
    if (isInitializing || !isDataLoaded) return;
    setMarketReportCache((prev) => {
      if (!prev) return prev;
      return prev.fingerprint === reportDataFingerprint ? prev : null;
    });
  }, [isInitializing, isDataLoaded, reportDataFingerprint]);

  // Prevent accidental refresh during critical operations
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isInitializing) return;
      if (!isDataLoaded && reviews.length === 0) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isInitializing, isDataLoaded, reviews.length]);

  // Save state to IndexedDB when it changes（有市场数据或仅有评论数据时都持久化）
  useEffect(() => {
    if (isInitializing) return;
    if (!isDataLoaded && reviews.length === 0) return;

    const saveState = async () => {
      try {
        // Persist all state for full recovery on refresh
        await set('marketplace', marketplace);
        await set('activeView', activeView);
        await set('isDataLoaded', isDataLoaded);
        
        // Heavy data
        await set('products', products);
        await set('history', history);
        await set('months', months);
        
        // Segment state
        await set('segments', segments);
        await set('asinToSegment', asinToSegment);
        await set('segmentChildren', segmentChildren);
        await set('asinToSubSegment', asinToSubSegment);
        await set('segmentDescriptions', segmentDescriptions);
        await set('segmentSubDescriptions', segmentSubDescriptions);
        await set('segmentDepth', segmentDepth);
        await set('segmentLevel3Children', segmentLevel3Children);
        await set('asinToLevel3Segment', asinToLevel3Segment);
        await set('segmentLevel3Descriptions', segmentLevel3Descriptions);
        await set('selectedSegment', selectedSegment);
        await set('selectedKpiMonths', selectedKpiMonths);
        await set('previousKpiMonths', previousKpiMonths);
        await set('lastYearKpiMonths', lastYearKpiMonths);
        
        // Content state
        await set('reviews', reviews);
        await set('persona', persona);
        await set('keywords', keywords);
        await set('marketReportCache', marketReportCache);
        await set('historySourceLabel', historySourceLabel);
        await set('anchorAnnotations', anchorAnnotations);
        
        localStorage.setItem('last_save_time', new Date().toISOString());
      } catch (err) {
        console.error("Failed to save state to IndexedDB:", err);
      }
    };

    const timer = setTimeout(saveState, 2000);
    return () => clearTimeout(timer);
  }, [
    marketplace, isInitializing, activeView, isDataLoaded,
    products, history, months, segments, asinToSegment, segmentChildren, asinToSubSegment, segmentDescriptions, segmentSubDescriptions,
    segmentDepth, segmentLevel3Children, asinToLevel3Segment, segmentLevel3Descriptions,
    selectedSegment, selectedKpiMonths, previousKpiMonths, lastYearKpiMonths,
    reviews, persona, keywords, marketReportCache, historySourceLabel, anchorAnnotations
  ]);

  const segmentFilterOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [{ value: 'all', label: '全部细分' }];
    segments.forEach((l1) => {
      options.push({ value: l1, label: l1 });
      if (segmentDepth < 2) return;
      (segmentChildren[l1] || []).forEach((l2) => {
        options.push({ value: makeLevel2Key(l1, l2), label: `↳ ${formatSegmentLabel(l1, l2)}` });
        if (segmentDepth < 3) return;
        const l3List = segmentLevel3Children[`${l1}::${l2}`] || [];
        l3List.forEach((l3) => {
          options.push({
            value: makeLevel3Key(l1, l2, l3),
            label: `↳ ${formatSegmentLabel(l1, l2, l3)}`,
          });
        });
      });
    });
    return options;
  }, [segments, segmentChildren, segmentLevel3Children, segmentDepth]);

  const selectedSegmentPath = useMemo(() => parseSegmentPathKey(selectedSegment), [selectedSegment]);

  const filteredProducts = useMemo(() => {
    if (selectedSegment === 'all') return products;
    return products.filter((p) =>
      productMatchesSegmentFilter(p.asin, selectedSegment, asinToSegment, asinToSubSegment, asinToLevel3Segment)
    );
  }, [products, asinToSegment, asinToSubSegment, asinToLevel3Segment, selectedSegment]);

  const handleSegmentDepthChange = useCallback((next: SegmentDepth) => {
    setSegmentDepth(next);
    setSelectedSegment((prev) => coerceSegmentFilterKey(prev, next));
  }, []);

  const filteredHistory = useMemo(() => {
    if (selectedSegment === 'all') return history;
    const filteredAsins = new Set(filteredProducts.map(p => p.asin));
    return history.filter(h => filteredAsins.has(h.asin));
  }, [history, filteredProducts, selectedSegment]);

  const getMarketplace = (file1: File, file2: File) => {
    const detect = (filename: string) => {
      const name = filename.toUpperCase();
      
      // Helper to check for standalone country code
      const matchCountry = (code: string) => {
        // Look for the code surrounded by common separators or at start/end of string
        // Separators: _, -, space, ., (, ), [, ], { , }
        const regex = new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`);
        return regex.test(name);
      };

      // Priority list of countries
      const countries = [
        { code: 'US', domain: 'amazon.com' },
        { code: 'UK', domain: 'amazon.co.uk' },
        { code: 'GB', domain: 'amazon.co.uk' },
        { code: 'DE', domain: 'amazon.de' },
        { code: 'FR', domain: 'amazon.fr' },
        { code: 'IT', domain: 'amazon.it' },
        { code: 'ES', domain: 'amazon.es' },
        { code: 'CA', domain: 'amazon.ca' },
        { code: 'JP', domain: 'amazon.co.jp' },
        { code: 'AU', domain: 'amazon.com.au' },
        { code: 'MX', domain: 'amazon.com.mx' },
        { code: 'IN', domain: 'amazon.in' },
        { code: 'BR', domain: 'amazon.com.br' },
        { code: 'SG', domain: 'amazon.sg' },
        { code: 'AE', domain: 'amazon.ae' },
        { code: 'SA', domain: 'amazon.sa' },
        { code: 'TR', domain: 'amazon.com.tr' },
        { code: 'NL', domain: 'amazon.nl' },
        { code: 'SE', domain: 'amazon.se' },
        { code: 'PL', domain: 'amazon.pl' },
        { code: 'BE', domain: 'amazon.com.be' },
      ];

      for (const country of countries) {
        if (matchCountry(country.code)) {
          return { code: country.code === 'GB' ? 'UK' : country.code, domain: country.domain };
        }
      }

      // Fallback to domain extensions in filename
      if (name.includes('.COM')) return { code: 'US', domain: 'amazon.com' };
      if (name.includes('.CO.UK')) return { code: 'UK', domain: 'amazon.co.uk' };
      if (name.includes('.DE')) return { code: 'DE', domain: 'amazon.de' };
      if (name.includes('.FR')) return { code: 'FR', domain: 'amazon.fr' };
      if (name.includes('.IT')) return { code: 'IT', domain: 'amazon.it' };
      if (name.includes('.ES')) return { code: 'ES', domain: 'amazon.es' };
      if (name.includes('.CA')) return { code: 'CA', domain: 'amazon.ca' };
      if (name.includes('.CO.JP')) return { code: 'JP', domain: 'amazon.co.jp' };
      
      return null;
    };

    const res1 = detect(file1.name);
    if (res1) return res1;
    const res2 = detect(file2.name);
    if (res2) return res2;

    return { code: 'US', domain: 'amazon.com' };
  };

  const handleDataLoaded = async (file1: File, file2: File) => {
    setIsLoading(true);
    try {
      // 优先从文件内容（货币符号）识别站点；文件名识别作兜底
      const contentDetected = await detectMarketplaceFromFile(file2) ?? await detectMarketplaceFromFile(file1);
      const marketplaceInfo = contentDetected ?? getMarketplace(file1, file2);
      console.log("Detected marketplace:", marketplaceInfo, contentDetected ? '(from file content)' : '(from filename)');
      
      toast.info("正在解析商品明细数据...");
      const parsedProducts = await parseProducts(file1);
      console.log(`Parsed ${parsedProducts.length} products`);
      
      toast.info("正在解析历史表现数据...");
      const { history: parsedHistory, months: parsedMonths } = await parseHistory(file2);
      console.log(`Parsed history for ${parsedHistory.length} ASINs, ${parsedMonths.length} months`);
      
      if (parsedProducts.length === 0) {
        console.error("No products found in file 1");
        toast.error("未在文件中找到有效的商品数据，请检查文件格式是否正确（需包含 ASIN 等列）。");
        setIsLoading(false);
        return;
      }

      if (parsedMonths.length === 0) {
        console.warn("No months found in history file");
        toast.warning("未在历史数据文件中找到有效的时间月份，部分趋势图表可能无法显示。");
      }
      
      toast.info("正在保存并初始化仪表盘...");

      setSelectedKpiMonths([]);
      setPreviousKpiMonths([]);
      setLastYearKpiMonths([]);
      
      // Save heavy data to IndexedDB FIRST to ensure persistence
      await set('products', parsedProducts);
      await set('history', parsedHistory);
      await set('months', parsedMonths);
      await set('marketplace', marketplaceInfo);
      await set('isDataLoaded', true);
      await set('historySourceLabel', file2.name);
      
      // Update state in chunks to avoid blocking main thread and potential OOM/Crash
      setSegments([]);
      setAsinToSegment({});
      setSegmentChildren({});
      setAsinToSubSegment({});
      setSegmentDescriptions({});
      setSegmentSubDescriptions({});
      setSelectedSegment('all');
      setAnchorAnnotations([]);
      setAnnotateMode(false);
      
      setMarketplace(marketplaceInfo);
      setHistorySourceLabel(file2.name);
      await new Promise(resolve => setTimeout(resolve, 100));
      setProducts(parsedProducts);
      await new Promise(resolve => setTimeout(resolve, 100));
      setHistory(parsedHistory);
      await new Promise(resolve => setTimeout(resolve, 100));
      setMonths(parsedMonths);
      await new Promise(resolve => setTimeout(resolve, 100));
      setIsDataLoaded(true);
      
      toast.success("数据加载成功！");
    } catch (error) {
      console.error("Error parsing files:", error);
      toast.error("解析文件失败，请确保文件格式正确。");
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    setConfirmAction({
      action: 'reset',
      message: '确定要清除所有数据并重置应用吗？此操作不可撤销。'
    });
  };

  const asinToBrand = useMemo(() => new Map(products.map(p => [p.asin, p.brand])), [products]);

  const calculateKpis = useCallback((targetMonths: string[], currentFilteredProducts: Product[], currentFilteredHistory: HistoryRecord[]) => {
    let revenue = 0;
    let sales = 0;
    
    const productCount = currentFilteredProducts.length;

    if (targetMonths.length === 0 || productCount === 0) {
      return { revenue: 0, sales: 0, avgPrice: 0, brands: 0, avgReviewCount: 0, avgReviewGrowth: 0, avgRating: 0, avgSellerCount: 0, avgWeight: 0, avgVolume: 0 };
    }

    const brandSet = new Set<string>();

    currentFilteredHistory.forEach(h => {
      targetMonths.forEach(m => {
        const monthData = h.history[m];
        if (monthData) {
          revenue += monthData.revenue;
          sales += monthData.sales;
          const brand = asinToBrand.get(h.asin);
          if (brand) brandSet.add(brand);
        }
      });
    });

    // Average price = total revenue / total sales (correct calculation)
    const avgPrice = sales > 0 ? revenue / sales : 0;

    const weightedProducts = currentFilteredProducts.filter(p => p.weight > 0);
    const volumedProducts = currentFilteredProducts.filter(p => p.volume > 0);

    const reviewCountSum = currentFilteredProducts.reduce((sum, p) => sum + p.reviewCount, 0);
    const reviewGrowthSum = currentFilteredProducts.reduce((sum, p) => sum + p.reviewGrowth, 0);
    const ratingSum = currentFilteredProducts.reduce((sum, p) => sum + p.rating, 0);
    const sellerCountSum = currentFilteredProducts.reduce((sum, p) => sum + p.sellerCount, 0);
    const weightSum = weightedProducts.reduce((sum, p) => sum + p.weight, 0);
    const volumeSum = volumedProducts.reduce((sum, p) => sum + p.volume, 0);

    return {
      revenue,
      sales,
      avgPrice,
      brands: brandSet.size,
      avgReviewCount: productCount > 0 ? reviewCountSum / productCount : 0,
      avgReviewGrowth: productCount > 0 ? reviewGrowthSum / productCount : 0,
      avgRating: productCount > 0 ? ratingSum / productCount : 0,
      avgSellerCount: productCount > 0 ? sellerCountSum / productCount : 0,
      avgWeight: weightedProducts.length > 0 ? weightSum / weightedProducts.length : 0,
      avgVolume: volumedProducts.length > 0 ? volumeSum / volumedProducts.length : 0,
    };
  }, [asinToBrand]);

  const kpiData = useMemo(() => calculateKpis(selectedKpiMonths, filteredProducts, filteredHistory), [calculateKpis, selectedKpiMonths, filteredProducts, filteredHistory]);
  const prevKpiData = useMemo(() => calculateKpis(previousKpiMonths, filteredProducts, filteredHistory), [calculateKpis, previousKpiMonths, filteredProducts, filteredHistory]);
  const lastYearKpiData = useMemo(() => calculateKpis(lastYearKpiMonths, filteredProducts, filteredHistory), [calculateKpis, lastYearKpiMonths, filteredProducts, filteredHistory]);

  const calculateTrend = (current: number, previous: number) => {
    if (previous === 0) return undefined;
    const value = ((current - previous) / previous) * 100;
    return { value: Math.abs(value), isPositive: value >= 0 };
  };

  const handleRangeChange = useCallback((selected: string[], previous: string[], lastYear: string[]) => {
    setSelectedKpiMonths(selected);
    setPreviousKpiMonths(previous);
    setLastYearKpiMonths(lastYear);
  }, []);

  /** 侧栏「定位」：切到批注所在 Tab 并滚动、高亮锚点模块 */
  const jumpToAnnotation = useCallback((a: AnchorAnnotation) => {
    setActiveView(a.view);
    setAnnotateMode(false);
    window.setTimeout(() => {
      const sel = `[data-annotate-anchor="${CSS.escape(a.anchorId)}"]`;
      const el = document.querySelector(sel) as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (el) {
        el.classList.add('annotate-anchor-flash');
        window.setTimeout(() => el.classList.remove('annotate-anchor-flash'), 1600);
      }
    }, 120);
  }, []);

  useEffect(() => {
    if (!currentUser || isLoading || isInitializing || isRestoring) return;
    const el = scrollMainRef.current;
    if (!el) return;
    const key = `workspaceScroll_${activeView}`;
    const onScroll = () => {
      sessionStorage.setItem(key, String(el.scrollTop));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeView, currentUser, isLoading, isInitializing, isRestoring]);

  useEffect(() => {
    if (isInitializing || isLoading || isRestoring || !currentUser) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const el = scrollMainRef.current;
      if (!el) return;
      const key = `workspaceScroll_${activeView}`;
      const saved = sessionStorage.getItem(key);
      el.scrollTop = saved ? parseInt(saved, 10) || 0 : 0;
    };
    const t = window.setTimeout(run, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [isInitializing, activeView, currentUser, isLoading, isRestoring]);

  return (
    <ErrorBoundary>
      <Toaster position="top-center" richColors className="no-print" />

      {/* ── Login Gate ───────────────────────────────────────────────── */}
      {!currentUser ? (
        <LoginPage onLoginSuccess={handleLoginSuccess} />
      ) : (
      <>
      {isLoading || isInitializing || isRestoring ? (
        <div className="min-h-screen bg-[#f5f5f7] flex flex-col items-center justify-center">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
          <h2 className="text-xl font-medium text-[#1d1d1f]">
            {isRestoring ? '正在恢复数据...' : (isInitializing ? '正在初始化...' : '正在处理数据...')}
          </h2>
          <p className="text-[#86868b] mt-2">这可能需要一些时间，取决于文件大小。</p>
        </div>
      ) : (
        <div className="min-h-screen bg-[#f5f5f7] font-sans text-[#1d1d1f] flex">
          {/* Sidebar */}
          <aside className="w-64 bg-white border-r border-black/5 hidden md:flex flex-col">
        <div className="p-6 border-b border-black/5">
          <div className="flex items-center space-x-2 font-semibold text-lg text-[#1d1d1f]">
            <BarChart3 className="w-6 h-6 text-indigo-600" />
            <span>AmzDev Tool</span>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          <button 
            onClick={() => setActiveView('market')}
            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl font-medium transition-colors ${activeView === 'market' ? 'bg-indigo-50 text-indigo-700' : 'text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'}`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>市场大盘</span>
          </button>
          <button 
            onClick={() => setActiveView('insights')}
            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl font-medium transition-colors ${activeView === 'insights' ? 'bg-indigo-50 text-indigo-700' : 'text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'}`}
          >
            <Users className="w-5 h-5" />
            <span>用户洞察</span>
          </button>
          <button 
            onClick={() => setActiveView('keywords')}
            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl font-medium transition-colors ${activeView === 'keywords' ? 'bg-indigo-50 text-indigo-700' : 'text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'}`}
          >
            <TrendingUp className="w-5 h-5" />
            <span>关键词分析</span>
          </button>
          <button 
            onClick={() => setActiveView('profit')}
            className={`w-full flex items-center space-x-3 px-3 py-2 rounded-xl font-medium transition-colors ${activeView === 'profit' ? 'bg-indigo-50 text-indigo-700' : 'text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f]'}`}
          >
            <Calculator className="w-5 h-5" />
            <span>利润计算器</span>
          </button>
        </nav>
        <div className="p-4 border-t border-black/5 space-y-2">
          {isRegisteredUser && (
            <div className="flex items-stretch gap-1.5 px-2">
              <button
                type="button"
                title="我的市场历史"
                aria-label="我的市场历史"
                onClick={() => setIsMarketHistoryOpen(true)}
                className="shrink-0 w-10 flex items-center justify-center rounded-xl border border-black/5 bg-[#f5f5f7] text-[#86868b] hover:bg-white hover:text-indigo-600 hover:border-indigo-100 transition-colors"
              >
                <History className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="保存当前市场到历史"
                onClick={() => void handleSaveMarketToHistory()}
                disabled={!isDataLoaded}
                className="flex-1 min-w-0 py-2 px-2 rounded-xl border border-black/5 bg-[#f5f5f7] text-xs font-semibold text-[#86868b] hover:bg-white hover:text-indigo-600 hover:border-indigo-100 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                保存市场
              </button>
            </div>
          )}
          <button 
            onClick={handleReupload}
            className="w-full flex items-center space-x-3 px-3 py-2 text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] rounded-xl font-medium transition-colors"
          >
            <Package className="w-5 h-5" />
            <span>重新上传数据</span>
          </button>
          <button 
            onClick={() => setIsAiSettingsOpen(true)}
            className="w-full flex items-center space-x-3 px-3 py-2 text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] rounded-xl font-medium transition-colors"
          >
            <Settings className="w-5 h-5" />
            <span>AI 设置</span>
          </button>
          <div className="flex items-center justify-between px-3 py-2 mt-1 bg-[#f5f5f7] rounded-xl">
            <div className="flex items-center gap-2 min-w-0">
              {isRegisteredUser ? (
                <button
                  type="button"
                  title="点击设置头像"
                  onClick={() => setIsAvatarSettingsOpen(true)}
                  className="w-7 h-7 rounded-full overflow-hidden border border-black/10 shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {currentUser?.avatarDataUrl ? (
                    <img src={currentUser.avatarDataUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">
                      {currentUser?.username?.[0]?.toUpperCase()}
                    </span>
                  )}
                </button>
              ) : (
                <div className="w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center shrink-0">
                  <span className="text-white text-[10px] font-bold">{currentUser?.username?.[0]?.toUpperCase()}</span>
                </div>
              )}
              <span className="text-xs font-medium text-[#1d1d1f] truncate">{currentUser?.username}</span>
            </div>
            <button onClick={handleLogout} className="text-[10px] text-[#86868b] hover:text-rose-600 transition-colors shrink-0 ml-2">退出</button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-md border-b border-black/5 px-8 py-4 flex items-center justify-between z-10 sticky top-0">
          <div className="flex items-center space-x-4">
            <div>
              <h1 className="text-[28px] font-semibold tracking-tight text-[#1d1d1f]">
                {activeView === 'market' ? '市场大盘' : activeView === 'insights' ? '用户洞察' : activeView === 'keywords' ? '关键词分析' : '利润计算器'}
              </h1>
              <p className="text-[15px] text-[#86868b] mt-1">
                {activeView === 'market' 
                  ? '分析市场趋势、竞争对手及产品机会。' 
                  : activeView === 'insights'
                  ? '分析竞品评论，深度解析用户真实反馈与画像。'
                  : activeView === 'keywords'
                  ? '深度分析关键词数据，AI 自动打标分类。'
                  : '多变体毛利率及成本结构分析。'}
              </p>
            </div>
            {activeView === 'market' && isDataLoaded && (
              <div className="flex items-center space-x-1 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-sm font-medium ml-4">
                <MapPin className="w-4 h-4" />
                <span>{marketplace.code}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0" data-print-hidden>
            <button
              type="button"
              onClick={handleExportPdf}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-black/10 bg-white text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors shadow-sm"
            >
              <Printer className="w-4 h-4 text-indigo-600" />
              存为 PDF
            </button>
            {activeView === 'market' && isDataLoaded && (
            <div className="flex items-center space-x-4">
              {/* Market Segmentation Button */}
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setIsSegmentationOpen(true)}
                  className="flex items-center space-x-2 px-4 py-2 bg-white border border-black/5 rounded-xl text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors shadow-sm"
                >
                  <Layers className="w-4 h-4 text-indigo-600" />
                  <span>市场细分</span>
                  {isSegAiRunning && !isSegmentationOpen && (
                    <span className="flex items-center gap-1 bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded-full animate-pulse">
                      <Loader2 className="w-2.5 h-2.5 animate-spin"/> AI运行中
                    </span>
                  )}
                </button>
              </div>

              {/* Segment Filter */}
              <div className="flex items-center space-x-2 bg-[#f5f5f7] px-4 py-2 rounded-xl border border-black/5">
                <Filter className="w-4 h-4 text-[#86868b]" />
                <select 
                  value={selectedSegment}
                  onChange={(e) => setSelectedSegment(e.target.value)}
                  className="bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
                >
                  {segmentFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="text-[13px] font-medium text-[#86868b] bg-[#f5f5f7] px-3 py-1.5 rounded-full border border-black/5">
                ASIN总数: <span className="text-[#1d1d1f]">{filteredProducts.length}</span>
              </div>
            </div>
            )}
          </div>
        </header>

        {/* Scrollable Content */}
        <div
          ref={scrollMainRef}
          id="main-workspace-scroll"
          data-annotate-anchor="workspace-scroll"
          className="flex-1 overflow-y-auto p-8"
        >
          <PageQuickNav />
          {!isDataLoaded && activeView === 'market' ? (
            <div className="h-full flex flex-col items-center justify-center space-y-8 py-20 animate-in fade-in duration-700">
              <div className="text-center space-y-2">
                <h2 className="text-[32px] font-bold text-[#1d1d1f] tracking-tight">欢迎使用 Amazon 市场洞察</h2>
                <p className="text-[#86868b] text-lg">上传您的市场数据，开启深度分析之旅</p>
              </div>
              <FileUpload onDataLoaded={handleDataLoaded} />
              <button 
                onClick={handleReset}
                className="text-sm text-[#86868b] hover:text-rose-600 transition-colors"
              >
                重置应用并清除缓存
              </button>
            </div>
          ) : (
            <>
              {activeView === 'market' && isDataLoaded &&
                <div className="max-w-7xl mx-auto space-y-8" data-annotate-anchor="market-root">
                {/* KPI Cards Header */}
                <div className="flex flex-col space-y-4" data-annotate-anchor="market-kpi-header">
                  {/* ── Market Scorecard ── */}
                  <MarketScorecard products={filteredProducts} history={filteredHistory} months={months} />

                  <div className="flex items-center justify-between">
                    <h2 className="text-[20px] font-semibold text-[#1d1d1f]">核心指标</h2>
                    <div className="flex items-center gap-4">
                      {segments.length > 0 && (
                        <button 
                          onClick={openMarketReport}
                          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 animate-in fade-in zoom-in duration-500"
                        >
                          <Sparkles className="w-4 h-4" />
                          生成市场分析报告
                        </button>
                      )}
                      <DateRangeSelector 
                        availableMonths={months} 
                        onRangeChange={handleRangeChange} 
                      />
                    </div>
                  </div>

                  {/* Segment Persona Card in Dashboard */}
                  {selectedSegment !== 'all' && (() => {
                    const path = selectedSegmentPath;
                    const activeDesc = path?.depth === 3
                      ? segmentLevel3Descriptions[selectedSegment]
                      : path?.depth === 2
                        ? segmentSubDescriptions[selectedSegment]
                        : segmentDescriptions[selectedSegment];
                    const activeLabel = path
                      ? formatSegmentLabel(path.level1, path.level2, path.level3)
                      : selectedSegment;
                    if (!activeDesc) return null;
                    return (
                      <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-sm animate-in fade-in slide-in-from-top-2">
                        <div className="flex items-center gap-2 mb-4">
                          <Users className="w-5 h-5 text-indigo-600" />
                          <h3 className="text-lg font-semibold text-[#1d1d1f]">细分市场画像：{activeLabel}</h3>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                          <div className="space-y-1">
                            <div className="text-[11px] font-bold text-[#86868b] uppercase tracking-widest">目标人群</div>
                            <p className="text-[14px] text-[#1d1d1f] leading-relaxed">{activeDesc.people}</p>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[11px] font-bold text-[#86868b] uppercase tracking-widest">使用场景</div>
                            <p className="text-[14px] text-[#1d1d1f] leading-relaxed">{activeDesc.scenarios}</p>
                          </div>
                          <div className="space-y-1">
                            <div className="text-[11px] font-bold text-[#86868b] uppercase tracking-widest">核心诉求与痛点</div>
                            <p className="text-[14px] text-[#1d1d1f] leading-relaxed">{activeDesc.needs}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* KPI Cards - 第一行：核心3指标，突出显示 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5" data-annotate-anchor="market-kpi-core">
                  <MetricCard large
                    title="总销售额"
                    value={formatRevenue(kpiData.revenue, marketplace.domain)}
                    icon={DollarSign}
                    tooltip="所选时间段内所有ASIN的月均销售额总和"
                    yoy={calculateTrend(kpiData.revenue, lastYearKpiData.revenue)}
                    mom={calculateTrend(kpiData.revenue, prevKpiData.revenue)}
                  />
                  <MetricCard large
                    title="总销量"
                    value={kpiData.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    icon={Package}
                    tooltip="所选时间段内所有ASIN的月均销量总和（件数）"
                    yoy={calculateTrend(kpiData.sales, lastYearKpiData.sales)}
                    mom={calculateTrend(kpiData.sales, prevKpiData.sales)}
                  />
                  <MetricCard large
                    title="平均价格"
                    value={`${getCurrencySymbol(marketplace.domain)}${kpiData.avgPrice.toFixed(2)}`}
                    icon={TrendingUp}
                    tooltip="市场内所有ASIN的销量加权平均售价"
                    yoy={calculateTrend(kpiData.avgPrice, lastYearKpiData.avgPrice)}
                    mom={calculateTrend(kpiData.avgPrice, prevKpiData.avgPrice)}
                  />
                </div>

                {/* KPI Cards - 第二行：竞争/市场指标 */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3" data-annotate-anchor="market-kpi-compete">
                  <MetricCard title="活跃品牌数" value={kpiData.brands.toLocaleString()} icon={Users} tooltip="在所选时间段内有销量记录的不重复品牌数量"/>
                  <MetricCard title="Top10链接垄断度"
                    value={(() => {
                      const sorted = [...filteredProducts].sort((a,b) => b.monthlySales - a.monthlySales).slice(0,10);
                      const top10Sales = sorted.reduce((s,p) => s+p.monthlySales, 0);
                      const total = filteredProducts.reduce((s,p) => s+p.monthlySales, 0);
                      return total > 0 ? `${((top10Sales/total)*100).toFixed(1)}%` : '-';
                    })()} icon={Trophy}
                    tooltip="Top10销量占大盘：销量Top10的ASIN合计销量 ÷ 全市场总销量。越高说明市场越集中，新品突围越难"/>
                  <MetricCard title="平均评论数" value={kpiData.avgReviewCount.toLocaleString(undefined, { maximumFractionDigits: 0 })} icon={MessageCircle} tooltip="所有ASIN的评论数算术平均值，反映市场整体竞争壁垒高度"/>
                  <MetricCard title="月评论平均增长" value={kpiData.avgReviewGrowth.toLocaleString(undefined, { maximumFractionDigits: 1 })} icon={Activity} tooltip="每个ASIN每月新增评论数的平均值，反映市场活跃度和买家反馈速度"/>
                  <MetricCard title="平均评分" value={kpiData.avgRating.toFixed(1)} icon={Star} tooltip="所有ASIN评分的算术平均值（满分5分）"/>
                </div>

                {/* KPI Cards - 第三行：产品物理/运营指标 */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3" data-annotate-anchor="market-kpi-ops">
                  <MetricCard title="平均卖家数" value={kpiData.avgSellerCount.toFixed(1)} icon={Store} tooltip="每个ASIN平均参与竞争的卖家数量，越高竞争越激烈"/>
                  <MetricCard title="平均重量 (kg)" value={kpiData.avgWeight.toFixed(2)} icon={Scale} tooltip="所有ASIN商品重量的平均值（千克），影响头程和FBA费用"/>
                  <MetricCard title="平均体积 (cm³)" value={kpiData.avgVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} icon={Box} tooltip="所有ASIN商品体积的平均值（立方厘米），影响仓储和运费"/>
                  <MetricCard title="新品渗透率" value={filteredProducts.length > 0 ? `${((filteredProducts.filter(p => p.daysSinceLaunch <= 90).length / filteredProducts.length) * 100).toFixed(1)}%` : '0%'} icon={Sparkles}
                    tooltip="近90天上架占比：近90天内上架的ASIN数量 ÷ 总ASIN数量。越高说明越多新卖家在入场，市场新陈代谢快"/>
                  <MetricCard title="平均FBA费率" value={(() => { const ps = filteredProducts.filter(p => p.fbaFee > 0 && p.price > 0); return ps.length ? `${(ps.reduce((s,p)=>s+p.fbaFee/p.price,0)/ps.length*100).toFixed(1)}%` : '-'; })()} icon={DollarSign}
                    tooltip="FBA费用/价格均值：FBA费用 ÷ 售价 的平均比值。一般低于15%为健康，越高说明平台物流成本侵蚀利润越严重"/>
                </div>

                {/* ── Opportunity Scanner (P1: moved up) ── */}
                <div data-annotate-anchor="market-opportunity-scanner">
                  <OpportunityScanner products={filteredProducts} history={filteredHistory} months={months} domain={marketplace.domain} asinToSegment={asinToSegment} />
                </div>

                {/* Charts Grid */}
                <div className="grid grid-cols-1 gap-6" data-annotate-anchor="market-charts">
                  <div data-annotate-anchor="segment-share-chart">
                    <SegmentShareChart 
                    products={products}
                    history={history}
                    months={selectedKpiMonths}
                    segments={segments}
                    asinToSegment={asinToSegment}
                    domain={marketplace.domain}
                  />
                  </div>
                  <div data-annotate-anchor="market-trend">
                    <MarketTrendChart history={filteredHistory} months={months} products={filteredProducts} asinToSegment={asinToSegment} domain={marketplace.domain} />
                  </div>
                  <div data-annotate-anchor="market-seasonal">
                    <SeasonalHeatmap history={filteredHistory} months={months} domain={marketplace.domain} />
                  </div>
                  <div data-annotate-anchor="market-concentration">
                    <MarketConcentrationChart products={filteredProducts} history={filteredHistory} months={months} domain={marketplace.domain} />
                  </div>
                  <div data-annotate-anchor="brand-leaderboard">
                    <BrandLeaderboard products={filteredProducts} history={filteredHistory} months={months} domain={marketplace.domain} asinToSegment={asinToSegment} />
                  </div>
                  <div data-annotate-anchor="bsr-distribution">
                    <BsrDistributionChart products={filteredProducts} domain={marketplace.domain} history={filteredHistory} months={months} asinToSegment={asinToSegment} />
                  </div>
                  <div data-annotate-anchor="price-rating">
                    <PriceRatingChart products={filteredProducts} history={filteredHistory} months={months} domain={marketplace.domain} asinToSegment={asinToSegment} />
                  </div>
                  <div data-annotate-anchor="price-distribution">
                    <PriceDistributionChart products={filteredProducts} domain={marketplace.domain} history={filteredHistory} months={months} asinToSegment={asinToSegment} />
                  </div>
                  <div data-annotate-anchor="launch-date">
                    <LaunchDateChart products={filteredProducts} domain={marketplace.domain} history={filteredHistory} months={months} asinToSegment={asinToSegment} />
                  </div>
                  <div data-annotate-anchor="new-vs-old">
                    <NewVsOldChart products={filteredProducts} domain={marketplace.domain} history={filteredHistory} months={months} asinToSegment={asinToSegment} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-annotate-anchor="rating-distribution">
                    <RatingDistributionChart products={filteredProducts} domain={marketplace.domain} history={filteredHistory} months={months} selectedMonths={selectedKpiMonths} asinToSegment={asinToSegment} />
                    <div data-annotate-anchor="seller-type">
                      <SellerTypeChart products={filteredProducts} domain={marketplace.domain} history={filteredHistory} months={months} selectedMonths={selectedKpiMonths} asinToSegment={asinToSegment} />
                    </div>
                  </div>
                  <div data-annotate-anchor="seller-location">
                    <SellerLocationChart products={filteredProducts} domain={marketplace.domain} history={filteredHistory} months={months} selectedMonths={selectedKpiMonths} asinToSegment={asinToSegment} />
                  </div>
                  <div id="asin-list" data-annotate-anchor="market-asin-list">
                    <TopProductsTable products={filteredProducts} history={filteredHistory} months={months} domain={marketplace.domain} asinToSegment={asinToSegment} asinToSubSegment={asinToSubSegment} asinToLevel3Segment={asinToLevel3Segment} selectedAsins={selectedCompareAsins} onToggleSelectAsin={toggleCompareAsin} />
                  </div>
                </div>
              </div>
              }

              {/* 有市场数据、或当前在用户洞察、或已有评论数据时保持挂载（后台打标不因切 Tab 中断） */}
              {(isDataLoaded || activeView === 'insights' || reviews.length > 0) && (
                <div
                  className={activeView === 'insights' ? 'max-w-7xl mx-auto' : 'hidden'}
                  data-annotate-anchor="insights-root"
                >
                  <UserInsights
                    products={products}
                    reviews={reviews}
                    setReviews={setReviews}
                    persona={persona}
                    setPersona={setPersona}
                    insightsUiActive={activeView === 'insights'}
                  />
                </div>
              )}

              {activeView === 'keywords' &&
                <div className="max-w-7xl mx-auto" data-annotate-anchor="keywords-root">
                  <KeywordAnalysis 
                    keywords={keywords} 
                    setKeywords={setKeywords} 
                  />
                </div>
              }

              {activeView === 'profit' &&
                <div className="max-w-7xl mx-auto" data-annotate-anchor="profit-root">
                  <ProfitCalculator />
                </div>
              }
            </>
          )}
        </div>
      </main>

      {/* ── ASIN Compare Bar ── */}
      <AsinCompareBar
        products={filteredProducts}
        selectedAsins={selectedCompareAsins}
        onRemove={(asin) => setSelectedCompareAsins(prev => prev.filter(a => a !== asin))}
        onClear={() => setSelectedCompareAsins([])}
        domain={marketplace.domain}
      />

      {!isLoading && !isInitializing && !isRestoring && (
        <AnchorAnnotationsLayer
          scrollRootRef={scrollMainRef}
          scrollLayoutKey={!isLoading && !isInitializing && !isRestoring}
          activeView={activeView}
          annotations={anchorAnnotations}
          onChange={setAnchorAnnotations}
          annotateMode={annotateMode}
          onAnnotateModeChange={setAnnotateMode}
          onJumpToAnnotation={jumpToAnnotation}
        />
      )}
    </div>
      )}

      {isDataLoaded && (
        <div className={isSegmentationOpen ? '' : 'hidden'}>
          <SegmentationManager 
            products={products}
            segments={segments}
            asinToSegment={asinToSegment}
            segmentChildren={segmentChildren}
            asinToSubSegment={asinToSubSegment}
            segmentDescriptions={segmentDescriptions}
            segmentSubDescriptions={segmentSubDescriptions}
            segmentDepth={segmentDepth}
            segmentLevel3Children={segmentLevel3Children}
            asinToLevel3Segment={asinToLevel3Segment}
            segmentLevel3Descriptions={segmentLevel3Descriptions}
            domain={marketplace.domain}
            onUpdateSegments={setSegments}
            onUpdateAsinToSegment={setAsinToSegment}
            onUpdateSegmentChildren={setSegmentChildren}
            onUpdateAsinToSubSegment={setAsinToSubSegment}
            onUpdateSegmentDescriptions={setSegmentDescriptions}
            onUpdateSegmentSubDescriptions={setSegmentSubDescriptions}
            onUpdateSegmentDepth={handleSegmentDepthChange}
            onUpdateSegmentLevel3Children={setSegmentLevel3Children}
            onUpdateAsinToLevel3Segment={setAsinToLevel3Segment}
            onUpdateSegmentLevel3Descriptions={setSegmentLevel3Descriptions}
            onGenerateReport={openMarketReport}
            onAiRunningChange={setIsSegAiRunning}
            onClose={handleCloseSegmentation}
          />
        </div>
      )}

      {isAiSettingsOpen && (
        <AiSettingsPanel
          settings={aiSettings}
          onSave={handleSaveAiSettings}
          onClose={() => setIsAiSettingsOpen(false)}
        />
      )}

      {/* AI Chatbot */}


      {confirmAction && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl p-6 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-[#1d1d1f] mb-4">确认操作</h3>
            <p className="text-sm text-[#86868b] mb-6">{confirmAction.message}</p>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-sm font-medium text-[#86868b] hover:text-[#1d1d1f] transition-colors"
              >
                取消
              </button>
              <button 
                onClick={executeReupload}
                className="px-6 py-2 bg-rose-600 text-white rounded-full text-sm font-semibold hover:bg-rose-700 transition-all shadow-md"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}

      {isRegisteredUser && (
        <MarketHistoryModal
          open={isMarketHistoryOpen}
          userId={currentUser!.id}
          onClose={() => setIsMarketHistoryOpen(false)}
          onApplySnapshot={applyMarketSnapshotFromHistory}
        />
      )}

      {isReportOpen && isReportHidden && (
        <button
          type="button"
          onClick={openMarketReport}
          className="fixed right-6 bottom-6 z-[65] px-4 py-3 rounded-2xl bg-indigo-600 text-white text-sm font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-colors"
        >
          查看后台报告
        </button>
      )}

      {isReportOpen && (
        <MarketAnalysisReport 
          products={products}
          history={history}
          months={months}
          segments={segments}
          asinToSegment={asinToSegment}
          segmentDescriptions={segmentDescriptions}
          cachedReportMarkdown={
            marketReportCache?.fingerprint === reportDataFingerprint ? marketReportCache.body : null
          }
          onPersistReport={handlePersistMarketReport}
          hidden={isReportHidden}
          onHide={hideMarketReport}
          onClose={closeMarketReport}
        />
      )}

      {isRegisteredUser && currentUser && (
        <AvatarSettingsModal
          open={isAvatarSettingsOpen}
          userId={currentUser.id}
          username={currentUser.username}
          currentAvatar={currentUser.avatarDataUrl}
          onClose={() => setIsAvatarSettingsOpen(false)}
          onSaved={(avatar) =>
            setCurrentUser((prev) => (prev ? { ...prev, avatarDataUrl: avatar } : prev))
          }
        />
      )}

      </>
      )}
    </ErrorBoundary>
  );
}
