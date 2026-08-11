import React, { useEffect, useState } from 'react';
import { CloudDownload, Loader2, AlertCircle } from 'lucide-react';
import {
  SELLERSPRITE_MARKETPLACES,
  getSellerSpriteStatus,
  normalizeMarketplaceCode,
  parseAsinList,
} from '../utils/sellerspriteApi';

export type McpFetchMode = 'reviews' | 'keywords';

interface McpFetchPanelProps {
  mode: McpFetchMode;
  defaultMarketplace?: string;
  /** 可选：从大盘商品里给几个快捷 ASIN 提示 */
  suggestAsins?: string[];
  onFetch: (params: {
    asins: string[];
    marketplace: string;
    maxPages: number;
    replace: boolean;
    onProgress: (msg: string) => void;
  }) => Promise<void>;
}

export function McpFetchPanel({
  mode,
  defaultMarketplace = 'US',
  suggestAsins = [],
  onFetch,
}: McpFetchPanelProps) {
  const [open, setOpen] = useState(false);
  const [asinText, setAsinText] = useState('');
  const [marketplace, setMarketplace] = useState(normalizeMarketplaceCode(defaultMarketplace));
  const [maxPages, setMaxPages] = useState(mode === 'reviews' ? 5 : 3);
  const [replace, setReplace] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [statusMsg, setStatusMsg] = useState('正在检查卖家精灵连接…');
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    setMarketplace(normalizeMarketplaceCode(defaultMarketplace));
  }, [defaultMarketplace]);

  useEffect(() => {
    let cancelled = false;
    getSellerSpriteStatus().then((s) => {
      if (cancelled) return;
      setConfigured(s.configured);
      setStatusMsg(s.message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const title = mode === 'reviews' ? '在线抓取评论' : '在线抓取关键词';
  const hint =
    mode === 'reviews'
      ? '输入竞品 ASIN，直接从卖家精灵拉取评论（无需再手动下载 Excel）'
      : '输入竞品 ASIN，直接拉取该 ASIN 的流量关键词（相当于 ABA/流量词反查）';

  const fillSuggest = () => {
    if (!suggestAsins.length) return;
    setAsinText(suggestAsins.slice(0, 5).join(', '));
  };

  const handleRun = async () => {
    const asins = parseAsinList(asinText);
    if (!asins.length) {
      setProgress('请先填写至少一个有效 ASIN（例如 B0XXXXXXXX）');
      return;
    }
    if (asins.length > 5) {
      setProgress('一次最多 5 个 ASIN，请减少后再试');
      return;
    }
    setLoading(true);
    setProgress('开始抓取…');
    try {
      await onFetch({
        asins,
        marketplace,
        maxPages,
        replace,
        onProgress: setProgress,
      });
      setProgress('完成');
      setOpen(false);
    } catch (e) {
      setProgress(e instanceof Error ? e.message : '抓取失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:from-violet-700 hover:to-indigo-700 shadow-sm"
      >
        <CloudDownload className="w-4 h-4" />
        {title}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-[min(100vw-2rem,380px)] bg-white border border-black/10 rounded-2xl shadow-xl p-4 space-y-3">
          <div>
            <div className="text-sm font-semibold text-[#1d1d1f]">{title}</div>
            <p className="text-xs text-[#86868b] mt-1 leading-relaxed">{hint}</p>
          </div>

          <div
            className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${
              configured ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {statusMsg}
              {!configured && (
                <>
                  {' '}
                  打开右上角「设置 → MCP 数据」填写密钥即可。
                </>
              )}
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-[#86868b] font-medium">竞品 ASIN（可多个）</label>
              {suggestAsins.length > 0 && (
                <button type="button" onClick={fillSuggest} className="text-[11px] text-indigo-600 hover:underline">
                  填入大盘 Top ASIN
                </button>
              )}
            </div>
            <textarea
              value={asinText}
              onChange={(e) => setAsinText(e.target.value)}
              placeholder="例如：B0D1XD1ZV3 或用逗号分隔多个"
              rows={2}
              className="w-full border border-black/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/20 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-[#86868b] font-medium block mb-1">站点</label>
              <select
                value={marketplace}
                onChange={(e) => setMarketplace(normalizeMarketplaceCode(e.target.value))}
                className="w-full border border-black/10 rounded-xl px-2 py-2 text-sm bg-white"
              >
                {SELLERSPRITE_MARKETPLACES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#86868b] font-medium block mb-1">
                最多抓取页数（每页约 50 条）
              </label>
              <input
                type="number"
                min={1}
                max={mode === 'reviews' ? 20 : 10}
                value={maxPages}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setMaxPages(Number.isFinite(n) ? n : 1);
                }}
                className="w-full border border-black/10 rounded-xl px-2 py-2 text-sm"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-[#1d1d1f] cursor-pointer">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
              className="rounded border-black/20"
            />
            覆盖当前已有数据（取消勾选则为追加）
          </label>

          {progress && (
            <div className="text-xs text-[#86868b] bg-[#f5f5f7] rounded-lg px-3 py-2">{progress}</div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-sm text-[#86868b] hover:text-[#1d1d1f]"
              disabled={loading}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={loading || !configured}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
              开始抓取
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
