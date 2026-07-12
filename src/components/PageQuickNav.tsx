import React, { useState, useEffect, useRef } from 'react';
import { Crosshair, ChevronRight, ChevronLeft, X } from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
}

const NAV_SECTIONS: NavItem[] = [
  { id: 'market-kpi-core', label: '核心指标' },
  { id: 'market-kpi-compete', label: '竞争指标' },
  { id: 'market-kpi-ops', label: '运营指标' },
  { id: 'market-opportunity-scanner', label: '机会扫描仪' },
  { id: 'segment-share-chart', label: '细分份额' },
  { id: 'market-trend', label: '市场趋势' },
  { id: 'market-seasonal', label: '季节性' },
  { id: 'market-concentration', label: '市场集中度' },
  { id: 'brand-leaderboard', label: '品牌排行' },
  { id: 'bsr-distribution', label: 'BSR分布' },
  { id: 'price-rating', label: '价格-评分' },
  { id: 'price-distribution', label: '价格分布' },
  { id: 'launch-date', label: '上架分析' },
  { id: 'new-vs-old', label: '新品vs旧品' },
  { id: 'rating-distribution', label: '评分分布' },
  { id: 'seller-type', label: '卖家类型' },
  { id: 'seller-location', label: '卖家分布' },
  { id: 'market-asin-list', label: 'ASIN列表' },
];

export const PageQuickNav: React.FC = () => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const navLockRef = useRef(false);

  useEffect(() => {
    const handleScroll = () => {
      if (navLockRef.current) return;
      const ids = NAV_SECTIONS.map(s => s.id);
      for (const id of ids) {
        const el = document.querySelector(`[data-annotate-anchor="${id}"]`);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 120 && rect.bottom > 0) {
            setActiveId(id);
            return;
          }
        }
      }
      setActiveId(ids[0] || null);
    };

    const el = document.getElementById('main-workspace-scroll');
    if (el) {
      el.addEventListener('scroll', handleScroll, { passive: true });
      handleScroll();
      return () => el.removeEventListener('scroll', handleScroll);
    }
  }, []);

  const scrollTo = (id: string) => {
    const el = document.querySelector(`[data-annotate-anchor="${id}"]`);
    if (el) {
      setActiveId(id);
      navLockRef.current = true;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => { navLockRef.current = false; }, 800);
    }
  };

  if (hidden) {
    return (
      <div className="fixed right-4 top-32 z-40 hidden xl:flex items-center" data-print-hidden>
        <button
          onClick={() => setHidden(false)}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-white border border-black/10 shadow-md hover:shadow-lg hover:border-indigo-200 transition-all text-slate-400 hover:text-indigo-600"
          title="展开导航"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <nav className="fixed right-4 top-32 z-40 hidden xl:block" data-print-hidden>
      <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-black/5 shadow-lg p-1.5 w-40 max-h-[70vh] overflow-y-auto custom-scroll">
        <div className="px-2 py-1.5 mb-0.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-slate-400 tracking-wider">
            <Crosshair className="w-3 h-3" />
            快速导航
          </div>
          <button
            onClick={() => setHidden(true)}
            className="p-0.5 rounded text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors"
            title="隐藏导航"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        {NAV_SECTIONS.map(item => (
          <button
            key={item.id}
            onClick={() => scrollTo(item.id)}
            className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-left transition-all
              ${activeId === item.id
                ? 'bg-indigo-50 text-indigo-700 font-semibold shadow-sm'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
          >
            <ChevronRight className={`w-3 h-3 flex-shrink-0 transition-transform ${activeId === item.id ? 'text-indigo-500' : 'text-slate-300'}`} />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};
