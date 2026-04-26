import React, { useEffect, useState } from 'react';
import { X, History, Loader2, Trash2, FolderOpen } from 'lucide-react';
import {
  listMarketHistoryMeta,
  deleteMarketSnapshot,
  loadMarketSnapshot,
  type MarketHistoryMeta,
  type MarketHistorySnapshot,
  MAX_MARKET_SNAPSHOTS_PER_USER,
} from '../utils/marketHistory';

interface MarketHistoryModalProps {
  open: boolean;
  userId: string;
  onClose: () => void;
  onApplySnapshot: (snap: MarketHistorySnapshot) => void;
}

export const MarketHistoryModal: React.FC<MarketHistoryModalProps> = ({
  open,
  userId,
  onClose,
  onApplySnapshot,
}) => {
  const [items, setItems] = useState<MarketHistoryMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setItems(await listMarketHistoryMeta(userId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open, userId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-lg rounded-[24px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-5 border-b border-black/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-xl">
              <History className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#1d1d1f]">我的市场历史</h2>
              <p className="text-xs text-[#86868b]">
                数据保存在本机浏览器，最多 {MAX_MARKET_SNAPSHOTS_PER_USER} 条；列表不占内存，点开才加载完整数据。
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-black/5 rounded-full">
            <X className="w-5 h-5 text-[#86868b]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#86868b] gap-2">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <span className="text-sm">加载列表…</span>
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-[#86868b] text-center py-12">暂无已保存的市场，请在有数据时点击「保存当前市场」。</p>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-start gap-3 p-3 rounded-xl border border-black/5 bg-[#f5f5f7]/50 hover:bg-[#f5f5f7] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-[#1d1d1f] line-clamp-2">{it.title}</div>
                    <div className="text-[11px] text-[#86868b] mt-1">
                      {it.marketplaceCode} · {it.productCount} ASIN · {it.segmentCount} 个细分 ·{' '}
                      {new Date(it.createdAt).toLocaleString('zh-CN', { hour12: false })}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={openingId !== null}
                      onClick={async () => {
                        setOpeningId(it.id);
                        try {
                          const snap = await loadMarketSnapshot(userId, it.id);
                          if (snap) {
                            onApplySnapshot(snap);
                            onClose();
                          }
                        } finally {
                          setOpeningId(null);
                        }
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {openingId === it.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <FolderOpen className="w-3.5 h-3.5" />
                      )}
                      打开
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm('确定删除这条历史记录？不可恢复。')) return;
                        await deleteMarketSnapshot(userId, it.id);
                        await refresh();
                      }}
                      className="flex items-center justify-center gap-1 px-3 py-1.5 text-rose-600 rounded-lg text-xs font-medium hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
