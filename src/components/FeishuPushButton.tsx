import React, { useState } from 'react';
import { Copy, Download, Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  copyTextToClipboard,
  downloadMarkdownFile,
  safeDownloadBasename,
} from '../utils/reportToMarkdown';
import {
  createFeishuDocFromMarkdown,
  isFeishuAuthorized,
  startFeishuOAuth,
} from '../utils/feishuAuth';

type Props = {
  /** 文档标题 */
  title: string;
  /** 获取当前报告 Markdown；可同步或异步 */
  getMarkdown: () => string | Promise<string>;
  /** 紧凑样式（报告顶栏） */
  compact?: boolean;
  className?: string;
};

export const FeishuPushButton: React.FC<Props> = ({
  title,
  getMarkdown,
  compact = false,
  className = '',
}) => {
  const [busy, setBusy] = useState<'copy' | 'download' | 'push' | null>(null);

  const resolveMd = async () => {
    const md = await Promise.resolve(getMarkdown());
    const text = (md || '').trim();
    if (!text) throw new Error('报告内容为空，请先生成报告');
    return text;
  };

  const onCopy = async () => {
    setBusy('copy');
    try {
      const md = await resolveMd();
      const ok = await copyTextToClipboard(md);
      if (ok) toast.success('已复制 Markdown，可粘贴到飞书文档');
      else toast.error('复制失败，请手动选择文本');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '复制失败');
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async () => {
    setBusy('download');
    try {
      const md = await resolveMd();
      downloadMarkdownFile(safeDownloadBasename(title), md);
      toast.success('已下载 .md 文件');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '下载失败');
    } finally {
      setBusy(null);
    }
  };

  const onPush = async () => {
    setBusy('push');
    try {
      const md = await resolveMd();
      if (!isFeishuAuthorized()) {
        toast.info('即将跳转飞书授权；授权回来后请再点一次「推送到飞书」');
        startFeishuOAuth(window.location.href);
        return;
      }
      const res = await createFeishuDocFromMarkdown(title, md);
      if (res.ok === false) {
        if (res.needAuth) {
          toast.info('需要重新授权飞书，正在跳转…');
          startFeishuOAuth(window.location.href);
          return;
        }
        if (res.needConfig) {
          toast.error('飞书应用尚未在服务器配置。请先用「复制 / 下载」导出。');
          return;
        }
        toast.error(res.error);
        return;
      }
      toast.success(
        <span>
          已推送到飞书。{' '}
          <a
            href={res.url}
            target="_blank"
            rel="noreferrer"
            className="underline font-semibold"
          >
            打开文档
          </a>
        </span>,
        { duration: 8000 }
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '推送失败');
    } finally {
      setBusy(null);
    }
  };

  const btnBase = compact
    ? 'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50'
    : 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => void onPush()}
        disabled={busy !== null}
        className={`${btnBase} bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700`}
        title="授权后写入你的飞书云空间"
      >
        {busy === 'push' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        推送到飞书
      </button>
      <button
        type="button"
        onClick={() => void onCopy()}
        disabled={busy !== null}
        className={`${btnBase} bg-white text-[#424245] border-black/10 hover:bg-[#f5f5f7]`}
      >
        {busy === 'copy' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
        复制 Markdown
      </button>
      <button
        type="button"
        onClick={() => void onDownload()}
        disabled={busy !== null}
        className={`${btnBase} bg-white text-[#424245] border-black/10 hover:bg-[#f5f5f7]`}
      >
        {busy === 'download' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        下载 .md
      </button>
    </div>
  );
};
