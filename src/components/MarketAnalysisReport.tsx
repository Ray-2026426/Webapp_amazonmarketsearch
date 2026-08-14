import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Sparkles, Loader2, FileText, TrendingUp, Users, Info, ShieldAlert, Edit3, Save, RotateCcw, EyeOff } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { getPrompt } from './AiPromptManager';
import { Product, HistoryRecord } from '../utils/parser';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FeishuPushButton } from './FeishuPushButton';
import { marketReportToMarkdown } from '../utils/reportToMarkdown';
// html2pdf loaded dynamically in handleDownloadPDF

interface MarketAnalysisReportProps {
  products: Product[];
  history: HistoryRecord[];
  months: string[];
  segments: string[];
  asinToSegment: Record<string, string>;
  segmentDescriptions: Record<string, { people: string, scenarios: string, needs: string }>;
  /** 与当前数据匹配的已生成报告，有则不再自动请求 AI */
  cachedReportMarkdown: string | null;
  /** 生成成功或用户保存编辑后写入父级与本地存储 */
  onPersistReport: (markdown: string) => void;
  hidden?: boolean;
  onHide?: () => void;
  onClose: () => void;
}

export const MarketAnalysisReport: React.FC<MarketAnalysisReportProps> = ({ 
  products, 
  history, 
  months, 
  segments, 
  asinToSegment, 
  segmentDescriptions,
  cachedReportMarkdown,
  onPersistReport,
  hidden = false,
  onHide,
  onClose 
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [report, setReport] = useState<string | null>(() => cachedReportMarkdown ?? null);
  const [hasFailed, setHasFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editedReport, setEditedReport] = useState<string>('');
  const reportRef = useRef<HTMLDivElement>(null);

  const generateReport = useCallback(async () => {
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) {
      toast.error('请先在「AI 设置」中配置 API Key');
      setHasFailed(true);
      return;
    }
    setIsGenerating(true);
    setHasFailed(false);
    setProgress(10);
    setStatus('正在分析市场数据...');
    
    try {
      const totalRevenue = products.reduce((sum, p) => sum + p.monthlyRevenue, 0);
      const totalSales = products.reduce((sum, p) => sum + p.monthlySales, 0);
      const avgPrice = totalSales > 0 ? totalRevenue / totalSales : 0;
      const topBrands = [...new Set(products.map(p => p.brand))].slice(0, 10).join(', ');
      
      const segmentSummary = segments.map(s => {
        const segmentProducts = products.filter(p => asinToSegment[p.asin] === s);
        const rev = segmentProducts.reduce((sum, p) => sum + p.monthlyRevenue, 0);
        const desc = segmentDescriptions[s] || { people: '未知', scenarios: '未知', needs: '未知' };
        const pct = totalRevenue > 0 ? ((rev / totalRevenue) * 100).toFixed(1) : '0';
        return `细分市场: ${s}\n- 销售额占比: ${pct}%\n- 用户画像: ${desc.people}\n- 使用场景: ${desc.scenarios}\n- 核心诉求: ${desc.needs}`;
      }).join('\n\n');

      setProgress(40);
      setStatus('AI 正在撰写深度分析报告...');

      const basePrompt = getPrompt('market_report') || '你是一位资深的亚马逊市场分析专家。请生成深度市场分析报告。';
      const prompt = `${basePrompt}

---

## 本次市场数据（请严格基于以下数据撰写）

市场基本数据：
- 总月销售额: $${totalRevenue.toLocaleString()}
- 总月销量: ${totalSales.toLocaleString()}
- 平均客单价: $${avgPrice.toFixed(2)}
- 头部品牌: ${topBrands}

细分市场及用户画像：
${segmentSummary}

产品示例 (前20个):
${products.slice(0, 20).map(p => `- ${p.title} (价格: $${p.price}, 评分: ${p.rating})`).join('\n')}

请开始撰写报告：`;

      const result = await generateText(prompt, aiSettings);
      const text = result || '生成失败，请重试。';
      setReport(text);
      setEditedReport(text);
      onPersistReport(text);
      setProgress(100);
      setStatus('报告生成完成！');
    } catch (error) {
      console.error('Report generation error:', error);
      setHasFailed(true);
      toast.error(`生成报告失败：${error instanceof Error ? error.message : '请检查 API 配置'}`);
    } finally {
      setIsGenerating(false);
      setTimeout(() => setProgress(0), 3000);
    }
  }, [products, segments, asinToSegment, segmentDescriptions, onPersistReport]);

  const generateReportRef = useRef(generateReport);
  generateReportRef.current = generateReport;

  useEffect(() => {
    if (cachedReportMarkdown) {
      setReport(cachedReportMarkdown);
      setEditedReport(cachedReportMarkdown);
      setHasFailed(false);
      return;
    }
    void generateReportRef.current();
  }, [cachedReportMarkdown]);

  const renderSection = (icon: React.ReactNode, title: string, content: string) => (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3 border-b border-black/5 pb-3">
        <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
          {icon}
        </div>
        <h3 className="text-xl font-bold text-[#1d1d1f]">{title}</h3>
      </div>
      <div className="prose prose-sm max-w-none text-[#424245] leading-relaxed">
        <Markdown>{content}</Markdown>
      </div>
    </div>
  );

  if (hidden) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 md:p-8">
      <Card className="w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl rounded-[32px] overflow-hidden border-none">
        <CardHeader className="flex flex-row items-center justify-between border-b border-black/5 pb-6 bg-white/80 backdrop-blur-sm sticky top-0 z-10 px-8 pt-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold text-[#1d1d1f]">AI 深度市场分析报告</CardTitle>
              <CardDescription className="text-[#86868b]">基于全量市场数据与 AI 逻辑框架生成的专业洞察</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap justify-end">
            {report && !isGenerating && (
              <FeishuPushButton
                compact
                title="AI 深度市场分析报告"
                getMarkdown={() => marketReportToMarkdown(isEditing ? editedReport : report)}
              />
            )}
            <button
              type="button"
              onClick={() => {
                if (isGenerating && onHide) {
                  onHide();
                  toast.info('报告已隐藏，AI 会在后台继续生成。');
                } else if (!isGenerating && onHide) {
                  onHide();
                }
              }}
              className="px-3 py-2 text-xs font-semibold rounded-xl bg-black/5 text-[#424245] hover:bg-black/10 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5">
                <EyeOff className="w-4 h-4" />
                {isGenerating ? '隐藏（后台继续）' : '隐藏'}
              </span>
            </button>
            <button onClick={onClose} className="p-2.5 hover:bg-black/5 rounded-full transition-colors text-[#86868b]">
              <X className="w-6 h-6" />
            </button>
          </div>
        </CardHeader>
        
        <CardContent className="flex-1 overflow-y-auto p-8 bg-[#f5f5f7]/30">
          {isGenerating || (!report && !hasFailed) ? (
            <div className="h-full flex flex-col items-center justify-center space-y-8">
              <div className="relative">
                <div className="w-24 h-24 border-4 border-indigo-100 rounded-full" />
                <div className="w-24 h-24 border-4 border-indigo-600 rounded-full border-t-transparent animate-spin absolute top-0" />
                <Sparkles className="w-8 h-8 text-indigo-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <div className="text-center space-y-3">
                <h3 className="text-xl font-bold text-[#1d1d1f]">{status}</h3>
                <p className="text-[#86868b] text-sm max-w-xs mx-auto">AI 正在深度扫描数千条数据点，并结合行业逻辑框架为您撰写报告...</p>
              </div>
              <div className="w-full max-w-md space-y-2">
                <div className="w-full bg-black/5 rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-indigo-600 h-full transition-all duration-700 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-bold text-[#86868b] uppercase tracking-widest">
                  <span>分析进度</span>
                  <span>{progress}%</span>
                </div>
              </div>
            </div>
          ) : report ? (
            <div className="max-w-4xl mx-auto space-y-12 pb-20">
              {/* Report Header Visual */}
              <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-[32px] p-10 text-white shadow-xl shadow-indigo-100 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 blur-3xl" />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-indigo-400/20 rounded-full -ml-24 -mb-24 blur-2xl" />
                
                <div className="relative z-10">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-[10px] font-bold uppercase tracking-widest mb-6">
                    <Sparkles className="w-3 h-3" />
                    AI Generated Insights
                  </div>
                  <h1 className="text-4xl font-bold mb-4 leading-tight">市场深度分析与进入策略报告</h1>
                  <div className="flex flex-wrap gap-6 text-sm text-white/80">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      <span>市场规模: $${(products.reduce((sum, p) => sum + p.monthlyRevenue, 0) / 1000000).toFixed(1)}M / 月</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      <span>细分市场: {segments.length} 个</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Info className="w-4 h-4" />
                      <span>生成时间: {new Date().toLocaleString('zh-CN', { hour12: false })}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Report Content */}
              <div className="bg-white rounded-[32px] p-10 shadow-sm border border-black/5 space-y-12" id="report-content" ref={reportRef}>
                {isEditing ? (
                  <textarea
                    value={editedReport}
                    onChange={(e) => setEditedReport(e.target.value)}
                    className="w-full min-h-[60vh] p-6 border border-indigo-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-sm resize-y"
                  />
                ) : (
                  <div className="markdown-body">
                    <Markdown remarkPlugins={[remarkGfm]}>{report}</Markdown>
                  </div>
                )}
              </div>

              {/* Action Footer */}
              <div className="flex items-center justify-center gap-4">
                <button 
                  onClick={onClose}
                  className="px-8 py-4 bg-[#1d1d1f] text-white rounded-2xl font-bold hover:bg-black transition-all shadow-lg"
                >
                  关闭报告
                </button>
                {isEditing ? (
                  <button 
                    onClick={() => {
                      setReport(editedReport);
                      onPersistReport(editedReport);
                      setIsEditing(false);
                      toast.success('报告已保存');
                    }}
                    className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg flex items-center gap-2"
                  >
                    <Save className="w-5 h-5" />
                    保存修改
                  </button>
                ) : (
                  <>
                    <button 
                      type="button"
                      onClick={() => setIsEditing(true)}
                      className="px-8 py-4 bg-white border border-black/10 text-[#1d1d1f] rounded-2xl font-bold hover:bg-[#f5f5f7] transition-all flex items-center gap-2"
                    >
                      <Edit3 className="w-5 h-5" />
                      编辑报告
                    </button>
                    <button 
                      type="button"
                      onClick={() => {
                        setIsEditing(false);
                        void generateReport();
                      }}
                      disabled={isGenerating}
                      className="px-8 py-4 bg-white border border-indigo-200 text-indigo-700 rounded-2xl font-bold hover:bg-indigo-50 transition-all flex items-center gap-2 disabled:opacity-50"
                    >
                      <RotateCcw className="w-5 h-5" />
                      强制重新生成
                    </button>
                  </>
                )}

              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 bg-rose-50 rounded-2xl flex items-center justify-center">
                <ShieldAlert className="w-8 h-8 text-rose-500" />
              </div>
              <h3 className="text-lg font-bold text-[#1d1d1f]">报告生成失败</h3>
              <p className="text-[#86868b] max-w-xs">由于网络或 API 限制，报告未能成功生成。请尝试重新生成。</p>
              <button 
                onClick={() => { setHasFailed(false); generateReport(); }}
                className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-all"
              >
                重新生成
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
