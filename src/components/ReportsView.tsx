import { useEffect, useState, type ReactNode } from 'react';
import { FileText, ChevronDown, ChevronRight, Download, Copy, CheckCircle2, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { MarkdownReport } from './MarkdownReport';
import { loadReports, finalizeReport, deleteReport, type ProjectReport, type ReportType } from '../utils/reportStore';
import type { ResearchProject } from '../types/researchProject';

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  market: '看市场报告',
  user: '看用户报告',
  competitor: '看竞品报告',
  self: '看自己适配报告',
  opportunity: '机会与决策报告',
  asin: '单 ASIN 深度报告',
  profit: '利润与风险报告',
};

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function ReportsView({
  userId,
  project,
  onContentChange,
}: {
  userId: string;
  project: ResearchProject;
  onContentChange?: () => void;
}) {
  const [reports, setReports] = useState<ProjectReport[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = async () => setReports(await loadReports(userId, project.id));

  useEffect(() => {
    let cancelled = false;
    void loadReports(userId, project.id).then((r) => { if (!cancelled) setReports(r); });
    return () => { cancelled = true; };
  }, [userId, project.id]);

  if (!reports) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-[#aeaeb2]">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> 正在加载报告…
      </div>
    );
  }

  const sorted = [...reports].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const onFinalize = async (r: ProjectReport) => {
    await finalizeReport(userId, project.id, r.id);
    toast.success(r.isFinalized ? '已取消定稿' : '已定稿');
    await refresh();
    onContentChange?.();
  };
  const onDelete = async (r: ProjectReport) => {
    await deleteReport(userId, project.id, r.id);
    toast.success('报告已删除');
    await refresh();
    onContentChange?.();
  };
  const onCopy = (r: ProjectReport) => {
    void navigator.clipboard?.writeText(r.markdown);
    toast.success('已复制 Markdown');
  };
  const onExportMd = (r: ProjectReport) => download(r.title + '.md', r.markdown, 'text/markdown');
  const onExportHtml = (r: ProjectReport) => {
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(r.title) + '</title><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:860px;margin:40px auto;padding:0 24px;line-height:1.7;color:#1d1d1f}pre{white-space:pre-wrap;background:#f5f5f7;padding:16px;border-radius:10px}</style></head><body><pre>' + escapeHtml(r.markdown) + '</pre></body></html>';
    download(r.title + '.html', html, 'text/html');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center shrink-0">
          <FileText className="w-5 h-5 text-indigo-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[#1d1d1f]">报告与版本</h3>
          <p className="text-sm text-[#86868b] mt-0.5">项目内的报告资产，按数据指纹与 Prompt 版本复用；数据变化生成新版本。</p>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Card className="py-12 text-center">
          <FileText className="w-6 h-6 text-[#c7c7cc] mx-auto mb-2" />
          <p className="text-sm text-[#aeaeb2]">暂无报告</p>
          <p className="text-xs text-[#c7c7cc] mt-1">生成报告后会自动归档到这里</p>
        </Card>
      ) : (
        sorted.map((r) => (
          <ReportCard
            key={r.id}
            report={r}
            open={openId === r.id}
            onToggle={() => setOpenId(openId === r.id ? null : r.id)}
            onFinalize={() => onFinalize(r)}
            onDelete={() => onDelete(r)}
            onCopy={() => onCopy(r)}
            onExportMd={() => onExportMd(r)}
            onExportHtml={() => onExportHtml(r)}
          />
        ))
      )}
    </div>
  );
}

function ReportCard({
  report,
  open,
  onToggle,
  onFinalize,
  onDelete,
  onCopy,
  onExportMd,
  onExportHtml,
}: {
  report: ProjectReport;
  open: boolean;
  onToggle: () => void;
  onFinalize: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onExportMd: () => void;
  onExportHtml: () => void;
}) {
  return (
    <Card>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <button type="button" onClick={onToggle} className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              {open ? <ChevronDown className="w-4 h-4 text-[#aeaeb2] shrink-0" /> : <ChevronRight className="w-4 h-4 text-[#aeaeb2] shrink-0" />}
              <h4 className="font-semibold text-[#1d1d1f] truncate">{report.title}</h4>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-[#86868b]">
              <span className="rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 font-semibold">{REPORT_TYPE_LABELS[report.reportType]}</span>
              <span>v{report.version}</span>
              <span>{report.modelName || '未知模型'}</span>
              <span>{fmtDate(report.updatedAt)}</span>
              {report.isFinalized && <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 font-semibold">已定稿</span>}
            </div>
          </button>
          <div className="flex items-center gap-1 shrink-0">
            <MiniBtn title="复制 Markdown" onClick={onCopy}><Copy className="w-3.5 h-3.5" /></MiniBtn>
            <MiniBtn title="导出 Markdown" onClick={onExportMd}><Download className="w-3.5 h-3.5" /></MiniBtn>
            <MiniBtn title="导出 HTML" onClick={onExportHtml}><FileText className="w-3.5 h-3.5" /></MiniBtn>
            <MiniBtn title={report.isFinalized ? '取消定稿' : '定稿'} onClick={onFinalize}><CheckCircle2 className="w-3.5 h-3.5" /></MiniBtn>
            <MiniBtn title="删除" danger onClick={onDelete}><Trash2 className="w-3.5 h-3.5" /></MiniBtn>
          </div>
        </div>
        {open && (
          <div className="mt-4 pt-4 border-t border-black/5">
            <MarkdownReport>{report.markdown}</MarkdownReport>
          </div>
        )}
      </div>
    </Card>
  );
}

function MiniBtn({ title, danger, onClick, children }: { title: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center w-8 h-8 rounded-lg border border-black/8 bg-white text-[#86868b] transition-all active:scale-[0.96]',
        danger ? 'hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50' : 'hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50'
      )}
    >
      {children}
    </button>
  );
}
