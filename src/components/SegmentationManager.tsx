import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, Plus, Trash2, Sparkles, Loader2, ChevronLeft, ChevronRight, Search, Check, ExternalLink, Users, Cloud, Ban } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/Card';
import { Product } from '../utils/parser';
import { loadAiSettings, generateText } from '../utils/aiConfig';
import { getPrompt } from './AiPromptManager';
import { toast } from 'sonner';
import { TitleWordCloudModal } from './TitleWordCloudModal';
import {
  parseFilterTerms,
  productSearchHaystack,
  matchesIncludeTerms,
  matchesExcludeRule,
} from '../utils/segmentFilter';

/** 仅用于筛选态：与真实细分市场名称区分，表示「尚未打标」 */
const UNCATEGORIZED_FILTER_KEY = '__uncategorized__';

function isUncategorizedAsin(asin: string, mapping: Record<string, string>): boolean {
  const v = mapping[asin];
  return v === undefined || v === null || String(v).trim() === '';
}

interface SegmentationManagerProps {
  products: Product[];
  segments: string[];
  asinToSegment: Record<string, string>;
  segmentDescriptions: Record<string, SegmentDescription>;
  domain: string;
  onUpdateSegments: (segments: string[]) => void;
  onUpdateAsinToSegment: (mapping: Record<string, string>) => void;
  onUpdateSegmentDescriptions: (descriptions: Record<string, SegmentDescription>) => void;
  onGenerateReport: () => void;
  onAiRunningChange?: (running: boolean) => void;
  onClose: () => void;
}

interface SegmentDescription {
  people: string;
  scenarios: string;
  needs: string;
}

export const SegmentationManager = React.memo(function SegmentationManager({ 
  products, 
  segments, 
  asinToSegment, 
  segmentDescriptions,
  domain,
  onUpdateSegments, 
  onUpdateAsinToSegment, 
  onUpdateSegmentDescriptions,
  onGenerateReport,
  onAiRunningChange,
  onClose 
}: SegmentationManagerProps) {
  const [newSegmentName, setNewSegmentName] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [includeMode, setIncludeMode] = useState<'or' | 'and'>('or');
  const [excludeTerm, setExcludeTerm] = useState('');
  const [excludeMode, setExcludeMode] = useState<'or' | 'and'>('or');
  const [wordCloudOpen, setWordCloudOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedManagerSegment, setSelectedManagerSegment] = useState<string | null>(null);
  const [isAiCategorizing, setIsAiCategorizing] = useState(false);
  const [isAiTagging, setIsAiTagging] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [selectedAsins, setSelectedAsins] = useState<Set<string>>(new Set());
  const [editingSegment, setEditingSegment] = useState<{oldName: string, newName: string} | null>(null);
  
  const pageSize = 50;

  const handleEditSegment = (oldName: string, newName: string) => {
    const trimmedNewName = newName.trim();
    if (!trimmedNewName || trimmedNewName === oldName) {
      setEditingSegment(null);
      return;
    }
    if (segments.includes(trimmedNewName)) {
      toast.error('该分类名称已存在');
      setEditingSegment(null);
      return;
    }

    // Update segments array
    const newSegments = segments.map(s => s === oldName ? trimmedNewName : s);
    onUpdateSegments(newSegments);

    // Update asinToSegment mapping
    const newMapping = { ...asinToSegment };
    let mappingUpdated = false;
    Object.keys(newMapping).forEach(asin => {
      if (newMapping[asin] === oldName) {
        newMapping[asin] = trimmedNewName;
        mappingUpdated = true;
      }
    });
    if (mappingUpdated) {
      onUpdateAsinToSegment(newMapping);
    }

    // Update segmentDescriptions
    const newDescriptions = { ...segmentDescriptions };
    if (newDescriptions[oldName]) {
      newDescriptions[trimmedNewName] = newDescriptions[oldName];
      delete newDescriptions[oldName];
      onUpdateSegmentDescriptions(newDescriptions);
    }

    if (selectedManagerSegment === oldName) {
      setSelectedManagerSegment(trimmedNewName);
    }
    
    setEditingSegment(null);
    toast.success(`分类 "${oldName}" 已重命名为 "${trimmedNewName}"`);
  };
  
  /** 左侧分类范围内的产品（词云统计用，不受搜索/排除影响） */
  const segmentScopedProducts = useMemo(() => {
    if (!selectedManagerSegment) return products;
    if (selectedManagerSegment === UNCATEGORIZED_FILTER_KEY) {
      return products.filter(p => isUncategorizedAsin(p.asin, asinToSegment));
    }
    return products.filter(p => asinToSegment[p.asin] === selectedManagerSegment);
  }, [products, selectedManagerSegment, asinToSegment]);

  const filteredProducts = useMemo(() => {
    let base = products;
    if (selectedManagerSegment) {
      if (selectedManagerSegment === UNCATEGORIZED_FILTER_KEY) {
        base = products.filter(p => isUncategorizedAsin(p.asin, asinToSegment));
      } else {
        base = products.filter(p => asinToSegment[p.asin] === selectedManagerSegment);
      }
    }
    const includeTerms = parseFilterTerms(searchTerm);
    const excludeTerms = parseFilterTerms(excludeTerm);
    return base.filter((p) => {
      const hay = productSearchHaystack(p);
      if (matchesExcludeRule(hay, excludeTerms, excludeMode)) return false;
      return matchesIncludeTerms(hay, includeTerms, includeMode);
    });
  }, [
    products,
    searchTerm,
    excludeTerm,
    includeMode,
    excludeMode,
    selectedManagerSegment,
    asinToSegment,
  ]);

  const allFilteredSelected =
    filteredProducts.length > 0 && filteredProducts.every(p => selectedAsins.has(p.asin));
  const someFilteredSelected = filteredProducts.some(p => selectedAsins.has(p.asin));
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = selectAllCheckboxRef.current;
    if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [someFilteredSelected, allFilteredSelected]);

  const totalPages = Math.ceil(filteredProducts.length / pageSize);
  const currentProducts = filteredProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleAddSegment = () => {
    if (newSegmentName.trim() && !segments.includes(newSegmentName.trim())) {
      onUpdateSegments([...segments, newSegmentName.trim()]);
      setNewSegmentName('');
    }
  };

  const handleRemoveSegment = (segment: string) => {
    onUpdateSegments(segments.filter(s => s !== segment));
    if (selectedManagerSegment === segment) setSelectedManagerSegment(null);
    
    const newMapping = { ...asinToSegment };
    Object.keys(newMapping).forEach(asin => {
      if (newMapping[asin] === segment) {
        delete newMapping[asin];
      }
    });
    onUpdateAsinToSegment(newMapping);

    const newDescriptions = { ...segmentDescriptions };
    delete newDescriptions[segment];
    onUpdateSegmentDescriptions(newDescriptions);
  };

  const handleTagProduct = (asin: string, segment: string) => {
    onUpdateAsinToSegment({
      ...asinToSegment,
      [asin]: segment
    });
  };

  const handleBulkTag = (segment: string) => {
    if (selectedAsins.size === 0) return;
    const count = selectedAsins.size;
    const newMapping = { ...asinToSegment };
    selectedAsins.forEach(asin => {
      newMapping[asin] = segment;
    });
    onUpdateAsinToSegment(newMapping);
    setSelectedAsins(new Set());
    toast.success(`已成功为 ${count} 个产品打标为 "${segment || '未分类'}"`);
  };

  /** 全选 / 取消全选：针对当前筛选结果的全部行（跨页），而非仅当前页 */
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedAsins(prev => {
        const next = new Set(prev);
        filteredProducts.forEach(p => next.delete(p.asin));
        return next;
      });
    } else {
      setSelectedAsins(prev => {
        const next = new Set(prev);
        filteredProducts.forEach(p => next.add(p.asin));
        return next;
      });
    }
  };

  const toggleSelectProduct = (asin: string) => {
    const newSelected = new Set(selectedAsins);
    if (newSelected.has(asin)) {
      newSelected.delete(asin);
    } else {
      newSelected.add(asin);
    }
    setSelectedAsins(newSelected);
  };

  const runAiCategorization = async () => {
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) {
      toast.error('请先在「AI 设置」中配置 API Key');
      return;
    }
    setIsAiCategorizing(true);
    onAiRunningChange?.(true);
    setProgress(20);
    setAiStatus('正在分析产品标题，生成细分建议...');
    
    try {
      const segmentationPrompt = getPrompt('segmentation');
      const prompt = `${segmentationPrompt}

对于每个建议的细分市场，请详细描述其背后的用户画像：
- 目标人群 (People)：该细分市场的主要购买者特征。
- 使用场景 (Scenarios)：他们通常在什么情况下使用这类产品。
- 核心诉求 (Needs)：他们最关注产品的哪些核心功能或价值点，以及主要痛点（可用一两句概括）。

【语言】细分市场名称、people、scenarios、needs 的正文必须全部使用简体中文；可保留英文产品词作补充，但不得以英文作为整段描述的主体语言。

请返回一个 JSON 对象：
{
  "segments": ["细分市场A", "细分市场B"],
  "descriptions": {
    "细分市场A": { "people": "...", "scenarios": "...", "needs": "..." }
  }
}

产品标题示例（共 ${products.length} 个）：
${products.slice(0, 80).map(p => p.title).join('\n')}`;

      setProgress(50);
      const responseText = await generateText(prompt, aiSettings, { jsonMode: true });
      const jsonMatch = responseText.match(/\{.*\}/s);
      const result = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);

      if (result.segments && result.segments.length > 0) {
        onUpdateSegments(result.segments);
        onUpdateSegmentDescriptions(result.descriptions || {});
        setProgress(100);
        setAiStatus('分类建议及画像已生成。');
        toast.success(`已生成 ${result.segments.length} 个细分市场`);
      } else {
        toast.error('AI 未返回有效分类，请重试。');
      }
    } catch (error) {
      console.error('AI Categorization error:', error);
      toast.error(`AI 自动分类失败：${error instanceof Error ? error.message : '请重试'}`);
    } finally {
      setIsAiCategorizing(false);
      onAiRunningChange?.(isAiTagging);
      setTimeout(() => { setAiStatus(''); setProgress(0); }, 3000);
    }
  };

  const runAutoTagging = async () => {
    if (segments.length === 0) { toast.error('请先创建或生成分类。'); return; }
    const aiSettings = loadAiSettings();
    if (!aiSettings?.apiKey) {
      toast.error('请先在「AI 设置」中配置 API Key');
      return;
    }

    setIsAiTagging(true);
    onAiRunningChange?.(true);
    setProgress(0);
    setAiStatus('准备开始自动打标...');
    
    try {
      const newMapping = { ...asinToSegment };
      const batchSize = 25;
      const totalToTag = Math.min(products.length, 500); 
      const batches = [];
      for (let i = 0; i < totalToTag; i += batchSize) {
        batches.push(products.slice(i, i + batchSize));
      }

      let completedCount = 0;
      
      for (const batch of batches) {
        const batchInfo = batch.map(p => `ASIN: ${p.asin}, Title: ${p.title}`).join('\n');
        const prompt = `将以下产品分配到最合适的分类中。
可用分类：${segments.join(', ')}

请仅返回一个 JSON 对象，键为 ASIN，值为分类名称（必须是可用分类之一，且与列表中的中文名称完全一致）。

产品列表：
${batchInfo}`;

        try {
          const responseText = await generateText(prompt, aiSettings, { jsonMode: true });
          const jsonMatch = responseText.match(/\{.*\}/s);
          const batchTags = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
          Object.assign(newMapping, batchTags);
        } catch (batchError) {
          console.error('Error processing batch:', batchError);
          toast.error('部分产品打标失败，已跳过。');
        }

        completedCount += batch.length;
        const pct = Math.round((completedCount / totalToTag) * 100);
        setProgress(pct);
        setAiStatus(`打标进度: ${completedCount}/${totalToTag} (${pct}%)`);
        if (completedCount < totalToTag) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      onUpdateAsinToSegment(newMapping);
      setProgress(100);
      setAiStatus('自动打标完成！');
      toast.success('自动打标完成！');
    } catch (error) {
      console.error('AI Tagging error:', error);
      toast.error(`自动打标失败：${error instanceof Error ? error.message : '请重试'}`);
    } finally {
      setIsAiTagging(false);
      onAiRunningChange?.(isAiCategorizing);
      setTimeout(() => { setAiStatus(''); setProgress(0); }, 3000);
    }
  };

  const selectedDescription = selectedManagerSegment ? segmentDescriptions[selectedManagerSegment] : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <Card className="w-full max-w-7xl h-[90vh] flex flex-col shadow-2xl rounded-[24px] overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between border-b border-black/5 pb-4 bg-[#f5f5f7]/50">
          <div>
            <CardTitle className="text-2xl font-semibold flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-indigo-600" />
              市场细分管理
            </CardTitle>
            <CardDescription>定义细分市场并为 ASIN 打标，以便在仪表盘中进行深度分析。</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {(isAiCategorizing || isAiTagging) && (
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-semibold hover:bg-indigo-100 transition-colors"
                title="隐藏窗口，AI 将继续在后台运行"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin"/>
                最小化，后台继续运行
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors">
              <X className="w-6 h-6 text-[#86868b]" />
            </button>
          </div>
        </CardHeader>
        
        <CardContent className="flex-1 overflow-hidden p-0 flex flex-col md:flex-row">
          {/* Left Panel */}
          <div className="w-full md:w-80 border-r border-black/5 bg-[#f5f5f7]/30 p-6 flex flex-col overflow-y-auto">
            <h3 className="text-sm font-semibold text-[#1d1d1f] uppercase tracking-wider mb-4">细分分类</h3>
            
            <div className="flex gap-2 mb-6">
              <input 
                type="text" 
                value={newSegmentName}
                onChange={(e) => setNewSegmentName(e.target.value)}
                placeholder="新分类名称"
                className="flex-1 px-3 py-2 bg-white border border-black/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                onKeyPress={(e) => e.key === 'Enter' && handleAddSegment()}
              />
              <button onClick={handleAddSegment} className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 mb-6">
              <button 
                onClick={() => setSelectedManagerSegment(null)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${!selectedManagerSegment ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-[#1d1d1f] border-black/5 hover:bg-black/5'}`}
              >
                <span className="text-sm font-medium">全部产品</span>
              </button>
              <button 
                type="button"
                onClick={() => setSelectedManagerSegment(UNCATEGORIZED_FILTER_KEY)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${selectedManagerSegment === UNCATEGORIZED_FILTER_KEY ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-[#1d1d1f] border-black/5 hover:bg-black/5'}`}
              >
                <span className="text-sm font-medium">未分类</span>
              </button>
              
              {segments.map(s => (
                <div 
                  key={s} 
                  onClick={() => {
                    if (editingSegment?.oldName !== s) {
                      setSelectedManagerSegment(s);
                    }
                  }}
                  className={`flex items-center justify-between group p-3 rounded-xl border cursor-pointer transition-all ${selectedManagerSegment === s ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-[#1d1d1f] border-black/5 hover:bg-black/5'}`}
                >
                  {editingSegment?.oldName === s ? (
                    <input
                      type="text"
                      value={editingSegment.newName}
                      onChange={(e) => setEditingSegment({ ...editingSegment, newName: e.target.value })}
                      onBlur={() => handleEditSegment(editingSegment.oldName, editingSegment.newName)}
                      onKeyPress={(e) => e.key === 'Enter' && handleEditSegment(editingSegment.oldName, editingSegment.newName)}
                      className="flex-1 px-2 py-1 text-sm bg-white text-black rounded border border-indigo-300 focus:outline-none"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span 
                      className="text-sm font-medium truncate flex-1"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingSegment({ oldName: s, newName: s });
                      }}
                      title="双击编辑名称"
                    >
                      {s}
                    </span>
                  )}
                  
                  {!editingSegment || editingSegment.oldName !== s ? (
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleRemoveSegment(s); }}
                      className={`p-1 transition-all ${selectedManagerSegment === s ? 'text-white/70 hover:text-white' : 'text-[#86868b] hover:text-rose-600 opacity-0 group-hover:opacity-100'}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="space-y-3 mt-auto pt-4 border-t border-black/5">
              <button 
                onClick={runAiCategorization}
                disabled={isAiCategorizing || isAiTagging}
                className="w-full py-3 bg-indigo-50 text-indigo-700 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-indigo-100 transition-all disabled:opacity-50"
              >
                {isAiCategorizing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
                {isAiCategorizing ? 'AI 分析中...' : 'AI 智能分类'}
              </button>
              <button 
                onClick={runAutoTagging}
                disabled={isAiCategorizing || isAiTagging || segments.length === 0}
                className="w-full py-3 bg-white border border-indigo-200 text-indigo-700 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-indigo-50 transition-all disabled:opacity-50"
              >
                {isAiTagging ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                {isAiTagging ? '打标中...' : '自动打标'}
              </button>
              {segments.length > 0 && (
                <button 
                  onClick={() => {
                    onClose();
                    onGenerateReport();
                  }}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 animate-in fade-in zoom-in duration-500"
                >
                  <Sparkles className="w-5 h-5" />
                  生成市场分析报告
                </button>
              )}
            </div>
            
            {(isAiCategorizing || isAiTagging) && (
              <div className="mt-4 space-y-2">
                <div className="w-full bg-black/5 rounded-full h-1.5 overflow-hidden">
                  <div 
                    className="bg-indigo-600 h-full transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider animate-pulse">
                    {aiStatus}
                  </span>
                  <span className="text-[10px] font-bold text-[#86868b]">
                    {progress}%
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Right Panel */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            <div className="p-4 border-b border-black/5 flex flex-col gap-3">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <span className="text-xs font-semibold text-[#1d1d1f] shrink-0">筛选分类</span>
                  <select
                    value={
                      selectedManagerSegment === null
                        ? 'all'
                        : selectedManagerSegment === UNCATEGORIZED_FILTER_KEY
                          ? UNCATEGORIZED_FILTER_KEY
                          : selectedManagerSegment
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'all') setSelectedManagerSegment(null);
                      else setSelectedManagerSegment(v);
                      setCurrentPage(1);
                    }}
                    className="w-full sm:max-w-xs px-3 py-2 bg-[#f5f5f7] border border-black/10 rounded-xl text-sm font-medium text-[#1d1d1f] focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="all">全部</option>
                    <option value={UNCATEGORIZED_FILTER_KEY}>未分类</option>
                    {segments.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#1d1d1f] flex items-center gap-1.5">
                        <Search className="w-3.5 h-3.5 text-[#86868b]" />
                        包含（ASIN / 标题 / 品牌）
                      </span>
                      <div className="flex rounded-lg border border-black/10 overflow-hidden text-[11px] font-semibold shrink-0">
                        <button
                          type="button"
                          onClick={() => { setIncludeMode('or'); setCurrentPage(1); }}
                          className={`px-2.5 py-1 transition-colors ${includeMode === 'or' ? 'bg-indigo-600 text-white' : 'bg-white text-[#86868b] hover:bg-[#f5f5f7]'}`}
                          title="命中任意一词即保留"
                        >
                          任意 OR
                        </button>
                        <button
                          type="button"
                          onClick={() => { setIncludeMode('and'); setCurrentPage(1); }}
                          className={`px-2.5 py-1 border-l border-black/10 transition-colors ${includeMode === 'and' ? 'bg-indigo-600 text-white' : 'bg-white text-[#86868b] hover:bg-[#f5f5f7]'}`}
                          title="须同时包含全部词"
                        >
                          全部 AND
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={searchTerm}
                      onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                      rows={2}
                      placeholder="多个词用逗号、分号或换行分隔。留空表示不按关键词筛选（仍受排除规则影响）"
                      className="w-full px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y min-h-[52px]"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[#1d1d1f] flex items-center gap-1.5">
                        <Ban className="w-3.5 h-3.5 text-rose-400" />
                        排除
                      </span>
                      <div className="flex rounded-lg border border-rose-200 overflow-hidden text-[11px] font-semibold shrink-0">
                        <button
                          type="button"
                          onClick={() => { setExcludeMode('or'); setCurrentPage(1); }}
                          className={`px-2.5 py-1 transition-colors ${excludeMode === 'or' ? 'bg-rose-600 text-white' : 'bg-white text-[#86868b] hover:bg-rose-50'}`}
                          title="命中任意一词即隐藏"
                        >
                          任意 OR
                        </button>
                        <button
                          type="button"
                          onClick={() => { setExcludeMode('and'); setCurrentPage(1); }}
                          className={`px-2.5 py-1 border-l border-rose-200 transition-colors ${excludeMode === 'and' ? 'bg-rose-600 text-white' : 'bg-white text-[#86868b] hover:bg-rose-50'}`}
                          title="仅当同时包含全部词时才隐藏"
                        >
                          全部 AND
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={excludeTerm}
                      onChange={(e) => { setExcludeTerm(e.target.value); setCurrentPage(1); }}
                      rows={2}
                      placeholder="多个词用逗号、分号或换行分隔。OR=任一词出现即隐藏；AND=全部词都出现才隐藏"
                      className="w-full px-3 py-2 bg-rose-50/80 border border-rose-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 resize-y min-h-[52px]"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setWordCloudOpen(true)}
                    disabled={segmentScopedProducts.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-sky-50 text-sky-800 border border-sky-200 rounded-xl text-sm font-semibold hover:bg-sky-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Cloud className="w-4 h-4" />
                    标题词云
                  </button>
                  <div className="text-sm text-[#86868b]">共 {filteredProducts.length} 个产品</div>
                </div>
              </div>

              <TitleWordCloudModal
                open={wordCloudOpen}
                onClose={() => setWordCloudOpen(false)}
                products={segmentScopedProducts}
                segmentLabel={
                  selectedManagerSegment === UNCATEGORIZED_FILTER_KEY
                    ? '未分类'
                    : selectedManagerSegment
                }
                emptyHint="当前分类下没有产品，无法生成词云"
              />

              {selectedAsins.size > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-200">
                    <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                      已选 {selectedAsins.size}
                    </span>
                    <select 
                      onChange={(e) => handleBulkTag(e.target.value)}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shadow-sm"
                      value=""
                    >
                      <option value="" disabled>批量打标为...</option>
                      <option value="">未分类</option>
                      {segments.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <button 
                      onClick={() => setSelectedAsins(new Set())}
                      className="p-2 text-[#86868b] hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                      title="取消选择"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Persona Display in Right Panel */}
            {selectedManagerSegment && selectedDescription && (
              <div className="px-6 py-4 bg-indigo-50/30 border-b border-indigo-100/50 animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-indigo-600" />
                  <h4 className="text-sm font-bold text-indigo-900">细分市场画像：{selectedManagerSegment}</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-white/60 p-3 rounded-xl border border-indigo-100/50">
                    <div className="text-[10px] font-bold text-indigo-400 uppercase mb-1 tracking-wider">目标人群</div>
                    <p className="text-xs text-indigo-900 leading-relaxed font-medium">{selectedDescription.people}</p>
                  </div>
                  <div className="bg-white/60 p-3 rounded-xl border border-indigo-100/50">
                    <div className="text-[10px] font-bold text-indigo-400 uppercase mb-1 tracking-wider">使用场景</div>
                    <p className="text-xs text-indigo-900 leading-relaxed font-medium">{selectedDescription.scenarios}</p>
                  </div>
                  <div className="bg-white/60 p-3 rounded-xl border border-indigo-100/50">
                    <div className="text-[10px] font-bold text-indigo-400 uppercase mb-1 tracking-wider">核心诉求</div>
                    <p className="text-xs text-indigo-900 leading-relaxed font-medium">{selectedDescription.needs}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-[#86868b] uppercase bg-[#f5f5f7] sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-3 w-10">
                      <input
                        ref={selectAllCheckboxRef}
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAll}
                        title="全选当前筛选结果（含所有分页）"
                        className="w-4 h-4 rounded border-black/10 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                      />
                    </th>
                    <th className="px-6 py-3 font-medium">产品信息</th>
                    <th className="px-6 py-3 font-medium">分类标签</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5">
                  {currentProducts.map(p => (
                    <tr 
                      key={p.asin} 
                      className={`transition-colors ${selectedAsins.has(p.asin) ? 'bg-indigo-50/50' : 'hover:bg-[#f5f5f7]/30'}`}
                      onClick={() => toggleSelectProduct(p.asin)}
                    >
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox" 
                          checked={selectedAsins.has(p.asin)}
                          onChange={() => toggleSelectProduct(p.asin)}
                          className="w-4 h-4 rounded border-black/10 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <img src={p.image} alt="" className="w-12 h-12 object-cover rounded-lg shadow-sm" referrerPolicy="no-referrer" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs text-indigo-600">{p.asin}</span>
                              <a 
                                href={`https://www.${domain}/dp/${p.asin}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="p-1 hover:bg-indigo-50 rounded text-indigo-600 transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                            <div className="font-medium text-[#1d1d1f] truncate max-w-md" title={p.title}>{p.title}</div>
                            <div className="text-xs text-[#86868b] mt-1">{p.brand}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                        <select 
                          value={asinToSegment[p.asin] || ''}
                          onChange={(e) => handleTagProduct(p.asin, e.target.value)}
                          className="w-full max-w-[200px] px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none cursor-pointer"
                        >
                          <option value="">未分类</option>
                          {segments.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredProducts.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-[#86868b]">
                  <Search className="w-12 h-12 mb-4 opacity-20" />
                  <p>未找到匹配的产品</p>
                </div>
              )}
            </div>

            {totalPages > 1 && (
              <div className="p-4 border-t border-black/5 flex items-center justify-center gap-4 bg-[#f5f5f7]/30">
                <button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1} className="p-2 hover:bg-black/5 rounded-full disabled:opacity-30 transition-colors">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-sm font-medium">第 {currentPage} 页 / 共 {totalPages} 页</span>
                <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages} className="p-2 hover:bg-black/5 rounded-full disabled:opacity-30 transition-colors">
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
});
