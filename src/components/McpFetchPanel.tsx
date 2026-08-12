import React, { useEffect, useState } from 'react';
import { CloudDownload, Loader2, AlertCircle, X } from 'lucide-react';
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
  suggestAsins?: string[];
  onFetch: (params: {
    asins: string[];
    marketplace: string;
    maxPages: number;
    replace: boolean;
    onProgress: (msg: string) => void;
  }) => Promise<void>;
}

/** 评论：每页约 20 条；关键词：每页约 50 条 */
const REVIEW_PAGE_SIZE = 20;
const KEYWORD_PAGE_SIZE = 50;

const REVIEW_TARGET_OPTIONS = [
  { label: '约 40 条', pages: 2 },
  { label: '约 100 条', pages: 5 },
  { label: '约 200 条', pages: 10 },
  { label: '约 400 条', pages: 20 },
];

const KEYWORD_TARGET_OPTIONS = [
  { label: '约 50 个', pages: 1 },
  { label: '约 100 个', pages: 2 },
  { label: '约 150 个', pages: 3 },
];

/** 用全屏居中弹层，避免被父级 overflow 裁切导致底部按钮点不到 */
export function McpFetchPanel({
  mode,
  defaultMarketplace = 'US',
  suggestAsins = [],
  onFetch,
}: McpFetchPanelProps) {
  const [open, setOpen] = useState(false);
  const [asinText, setAsinText] = useState('');
  const [marketplace, setMarketplace] = useState(normalizeMarketplaceCode(defaultMarketplace));
  const [maxPages, setMaxPages] = useState(mode === 'reviews' ? 5 : 2);
  const [replace, setReplace] = useState(true);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [statusMsg, setStatusMsg] = useState('正在检查卖家精灵连接…');
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    setMarketplace(normalizeMarketplaceCode(defaultMarketplace));
  }, [defaultMarketplace]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getSellerSpriteStatus().then((s) => {
      if (cancelled) return;
      setConfigured(s.configured);
      setStatusMsg(s.message);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

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

  const targetOptions = mode === 'reviews' ? REVIEW_TARGET_OPTIONS : KEYWORD_TARGET_OPTIONS;
  const perPageHint =
    mode === 'reviews'
      ? `卖家精灵评论接口每页约 ${REVIEW_PAGE_SIZE} 条；选「约 100 条」= 翻 5 页`
      : `流量词每页约 ${KEYWORD_PAGE_SIZE} 个；按目标数量自动翻页，无需关心页码`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-xl text-sm font-semibold hover:from-violet-700 hover:to-indigo-700 shadow-sm"
      >
        <CloudDownload className="w-4 h-4" />
        {title}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 backdrop-blur-sm p-4">
          <div className="bg-white w-full max-w-md max-h-[90vh] rounded-2xl shadow-2xl border border-black/10 flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-black/5 flex items-start justify-between gap-3 shrink-0">
              <div>
                <div className="text-base font-semibold text-[#1d1d1f]">{title}</div>
                <p className="text-xs text-[#86868b] mt-1 leading-relaxed">{hint}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg hover:bg-[#f5f5f7] text-[#86868b]"
                disabled={loading}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
              <div
                className={`text-xs rounded-xl px-3 py-2 flex items-start gap-2 ${
                  configured ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                }`}
              >
                {!configured && <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                <span>{statusMsg}</span>
              </div>

              <div>
                <label className="text-xs text-[#86868b] font-medium block mb-1">ASIN（可多个，逗号分隔）</label>
                <textarea
                  value={asinText}
                  onChange={(e) => setAsinText(e.target.value)}
                  rows={3}
                  placeholder="例如：B0XXXXXXXX, B0YYYYYYYY"
                  className="w-full border border-black/10 rounded-xl px-3 py-2 text-sm font-mono resize-y"
                />
                {suggestAsins.length > 0 && (
                  <button type="button" onClick={fillSuggest} className="mt-1.5 text-xs text-violet-600 hover:underline">
                    填入建议 ASIN（前 5 个）
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
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
                    {mode === 'reviews' ? '目标评论条数' : '目标关键词数量'}
                  </label>
                  <select
                    value={maxPages}
                    onChange={(e) => setMaxPages(parseInt(e.target.value, 10) || 1)}
                    className="w-full border border-black/10 rounded-xl px-2 py-2 text-sm bg-white"
                  >
                    {targetOptions.map((opt) => (
                      <option key={opt.pages} value={opt.pages}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <div className="text-[10px] text-[#86868b] mt-1 leading-relaxed">{perPageHint}</div>
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
                <div className="text-xs text-[#86868b] bg-[#f5f5f7] rounded-lg px-3 py-2 whitespace-pre-wrap">{progress}</div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-black/5 flex justify-end gap-2 shrink-0 bg-white">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm text-[#86868b] hover:text-[#1d1d1f]"
                disabled={loading}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={loading || !configured}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudDownload className="w-3.5 h-3.5" />}
                开始抓取
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
