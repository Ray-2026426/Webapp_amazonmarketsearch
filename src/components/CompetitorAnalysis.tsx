import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  Upload, Sparkles, Loader2, Image as ImageIcon, FileText,
  RotateCcw, X, CheckCircle2, ArrowLeft, Maximize2,
} from 'lucide-react';
import { loadAiSettings, generateWithImages, generateText, type ImageInput, type AiSettings } from '../utils/aiConfig';
import { parseSingleCompetitorZip } from '../utils/competitorArchiveParser';
import { toast } from 'sonner';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'upload' | 'analyzing' | 'report';
type ReportTab = 'main' | 'aplus' | 'bullet';

interface ImageFile {
  id: string;
  name: string;
  previewUrl: string;
  base64: string;
  mimeType: string;
}

interface CompetitorEntry {
  id: string;
  name: string;
  mainImages: ImageFile[];
  aplusImages: ImageFile[];
  bulletPoints: string;
  zipName?: string;
}

interface ImageAnalysisResult {
  imageId: string;
  competitorId: string;
  competitorName: string;
  category: 'main' | 'aplus';
  imageIndex: number;
  analysis: string;
  previewUrl: string;
  imageName: string;
}

interface SectionResult {
  perImage: ImageAnalysisResult[];
  crossComparison: string;
}

interface AnalysisOutput {
  main: SectionResult;
  aplus: SectionResult;
  bulletComparison: string;
}

const SLOT_LABELS = ['竞品 1', '竞品 2'] as const;
const IMAGE_MAX_WIDTH = 1400;

// ─── Utils & Prompts (unchanged logic) ────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function emptySlot(label: string): CompetitorEntry {
  return { id: generateId(), name: label, mainImages: [], aplusImages: [], bulletPoints: '' };
}

function compressImageBlob(blob: Blob, maxWidth: number): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const previewUrl = URL.createObjectURL(blob);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round(height * (maxWidth / width));
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg', previewUrl });
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(blob);
  });
}

async function blobToImageFile(blob: Blob, fileName: string): Promise<ImageFile> {
  const { base64, mimeType, previewUrl } = await compressImageBlob(blob, IMAGE_MAX_WIDTH);
  return { id: generateId(), name: fileName, previewUrl, base64, mimeType };
}

function revokeImages(entry: CompetitorEntry) {
  [...entry.mainImages, ...entry.aplusImages].forEach((img) => URL.revokeObjectURL(img.previewUrl));
}

const SINGLE_IMAGE_SYSTEM = `你是亚马逊 Listing 视觉审计专家。你必须只根据图片中真实可见的内容分析。看不清写「未能辨识」，严禁编造。`;

const singleImagePrompt = (compName: string, category: 'main' | 'aplus', index: number, total: number, fileName: string) => `
解读【${compName}】的第 ${index + 1}/${total} 张${category === 'main' ? '主图' : 'A+图'}（${fileName}）。

## 一、画面内容（逐项，基于真实画面）
- 产品本体（颜色/形态/材质/部件）
- 图中文字 OCR（原文摘录 + 位置）
- 图标角标认证
- 人物场景与背景元素

## 二、视觉营销解读
构图重心 | 配色调性 | 信息层级 | 卖点传达 | 目标客群 | 优缺点

## 三、Listing 作用
说明此图在买家决策中的作用及依据。

简体中文，不少于 400 字，观察要具体。`;

const crossComparePrompt = (section: '主图' | 'A+', competitors: CompetitorEntry[], analyses: ImageAnalysisResult[]) => {
  const blocks = competitors.map((c) => {
    const items = analyses.filter((a) => a.competitorId === c.id);
    if (!items.length) return '';
    return `### ${c.name}\n${items.map((r) => `#### ${r.imageName}\n${r.analysis}`).join('\n\n')}`;
  }).filter(Boolean).join('\n\n---\n\n');

  return `对以下竞品【${section}】做深度横向对比。必须引用具体观察，禁止空话。

## 一、各竞品整体策略画像
## 二、同序号对比（第1张 vs 第1张…）
## 三、差异化矩阵（Markdown 表格）
## 四、图中文案与卖点对比
## 五、优劣势与机会点

【逐张分析】
${blocks}`;
};

const BULLET_COMPARE_PROMPT = `对比以下竞品五点文案。输出：结构对比表 | 关键词意图 | 卖点优先级差异 | 痛点覆盖 | 3-5条差异化建议。引用原文。`;

// ─── Main Component ───────────────────────────────────────────────────────────

export const CompetitorAnalysis: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('upload');
  const [reportTab, setReportTab] = useState<ReportTab>('main');
  const [slots, setSlots] = useState<CompetitorEntry[]>([emptySlot(SLOT_LABELS[0]), emptySlot(SLOT_LABELS[1])]);
  const [parsingSlot, setParsingSlot] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisOutput | null>(null);
  const [progress, setProgress] = useState('');
  const [detailResult, setDetailResult] = useState<ImageAnalysisResult | null>(null);
  const abortRef = useRef(false);
  const fileRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];

  const ready = slots.every((s) => s.zipName && (s.mainImages.length + s.aplusImages.length > 0));

  const updateSlot = useCallback((index: number, patch: Partial<CompetitorEntry>) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }, []);

  const handleSlotUpload = useCallback(async (slotIndex: number, file: File | null) => {
    if (!file) return;
    setParsingSlot(slotIndex);
    try {
      const { competitor: parsed, warnings } = await parseSingleCompetitorZip(file, SLOT_LABELS[slotIndex]);
      const mainImages: ImageFile[] = [];
      const aplusImages: ImageFile[] = [];
      for (const img of parsed.mainImages) {
        try { mainImages.push(await blobToImageFile(img.blob, img.fileName)); } catch { /* skip */ }
      }
      for (const img of parsed.aplusImages) {
        try { aplusImages.push(await blobToImageFile(img.blob, img.fileName)); } catch { /* skip */ }
      }

      setSlots((prev) => {
        const next = [...prev];
        revokeImages(next[slotIndex]);
        next[slotIndex] = {
          ...next[slotIndex],
          name: parsed.folderName || SLOT_LABELS[slotIndex],
          mainImages, aplusImages,
          bulletPoints: parsed.bulletPoints,
          zipName: file.name,
        };
        return next;
      });
      toast.success(`${SLOT_LABELS[slotIndex]} 已导入：主图 ${mainImages.length} · A+ ${aplusImages.length}`);
      if (warnings[0]) toast.warning(warnings[0], { duration: 4000 });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '解析失败');
    } finally {
      setParsingSlot(null);
      if (fileRefs[slotIndex].current) fileRefs[slotIndex].current!.value = '';
    }
  }, [fileRefs]);

  const analyzeOneImage = async (
    comp: CompetitorEntry, img: ImageFile, category: 'main' | 'aplus',
    index: number, total: number, settings: AiSettings
  ): Promise<ImageAnalysisResult> => {
    const text = await generateWithImages(
      singleImagePrompt(comp.name, category, index, total, img.name),
      [{ base64: img.base64, mimeType: img.mimeType }],
      settings,
      { systemPrompt: SINGLE_IMAGE_SYSTEM }
    );
    return {
      imageId: img.id, competitorId: comp.id, competitorName: comp.name,
      category, imageIndex: index, analysis: text,
      previewUrl: img.previewUrl, imageName: img.name,
    };
  };

  const analyzeSection = async (
    category: 'main' | 'aplus', settings: AiSettings,
    activeComps: CompetitorEntry[], onProgress: (msg: string) => void
  ): Promise<SectionResult> => {
    const label = category === 'main' ? '主图' : 'A+';
    const perImage: ImageAnalysisResult[] = [];
    const total = activeComps.reduce((s, c) => s + (category === 'main' ? c.mainImages.length : c.aplusImages.length), 0);
    let done = 0;

    for (const comp of activeComps) {
      if (abortRef.current) break;
      const images = category === 'main' ? comp.mainImages : comp.aplusImages;
      for (let i = 0; i < images.length; i++) {
        if (abortRef.current) break;
        done++;
        onProgress(`${label} · ${comp.name} · ${done}/${total}`);
        try {
          perImage.push(await analyzeOneImage(comp, images[i], category, i, images.length, settings));
        } catch (err: unknown) {
          perImage.push({
            imageId: images[i].id, competitorId: comp.id, competitorName: comp.name,
            category, imageIndex: i,
            analysis: `分析失败：${err instanceof Error ? err.message : '未知错误'}`,
            previewUrl: images[i].previewUrl, imageName: images[i].name,
          });
        }
      }
    }

    if (abortRef.current || !perImage.length) return { perImage, crossComparison: '' };

    onProgress(`${label} · 生成对比结论…`);
    let crossComparison = '';
    try {
      crossComparison = await generateText(crossComparePrompt(label, activeComps, perImage), settings);
    } catch (err: unknown) {
      crossComparison = `对比结论生成失败：${err instanceof Error ? err.message : '未知错误'}`;
    }
    return { perImage, crossComparison };
  };

  const startAnalysis = useCallback(async () => {
    const settings = loadAiSettings();
    if (!settings) { toast.error('请先在「AI 设置」配置 API Key'); return; }
    if (!ready) { toast.error('请先上传两个竞品的压缩包'); return; }

    const activeComps = slots.filter((s) => s.mainImages.length + s.aplusImages.length > 0);
    setPhase('analyzing');
    abortRef.current = false;
    setAnalysis(null);

    try {
      const main = await analyzeSection('main', settings, activeComps, setProgress);
      if (abortRef.current) { setPhase('upload'); return; }

      const aplus = await analyzeSection('aplus', settings, activeComps, setProgress);
      if (abortRef.current) { setPhase('upload'); return; }

      let bulletComparison = '';
      const withBullets = activeComps.filter((c) => c.bulletPoints.trim());
      if (withBullets.length >= 2) {
        setProgress('五点文案 · 对比分析…');
        const body = withBullets.map((c) => `### ${c.name}\n${c.bulletPoints.trim()}`).join('\n\n');
        bulletComparison = await generateText(`${BULLET_COMPARE_PROMPT}\n\n${body}`, settings);
      } else if (withBullets.length === 1) {
        bulletComparison = '仅识别到一个竞品的五点，请补充另一个竞品后再分析。';
      }

      setAnalysis({ main, aplus, bulletComparison });
      setPhase('report');
      setReportTab('main');
      toast.success('报告已生成');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '分析失败');
      setPhase('upload');
    } finally {
      setProgress('');
    }
  }, [slots, ready]);

  const resetAll = () => {
    slots.forEach(revokeImages);
    setSlots([emptySlot(SLOT_LABELS[0]), emptySlot(SLOT_LABELS[1])]);
    setAnalysis(null);
    setPhase('upload');
    setDetailResult(null);
  };

  const stepIndex = phase === 'upload' ? 1 : phase === 'analyzing' ? 2 : 3;

  return (
    <div className="max-w-5xl mx-auto">
      {/* 步骤条 */}
      <StepBar current={stepIndex} />

      {/* ── 阶段一：上传 ── */}
      {phase === 'upload' && (
        <div className="space-y-6 mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {slots.map((slot, idx) => (
              <UploadSlot
                key={slot.id}
                label={SLOT_LABELS[idx]}
                slot={slot}
                loading={parsingSlot === idx}
                inputRef={fileRefs[idx]}
                onUpload={(f) => void handleSlotUpload(idx, f)}
                onClear={() => {
                  setSlots((prev) => {
                    const next = [...prev];
                    revokeImages(next[idx]);
                    next[idx] = emptySlot(SLOT_LABELS[idx]);
                    return next;
                  });
                }}
              />
            ))}
          </div>

          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={!ready}
              onClick={() => void startAnalysis()}
              className="flex items-center gap-2 px-10 py-3.5 bg-indigo-600 text-white rounded-2xl font-semibold hover:bg-indigo-700 disabled:opacity-35 transition-all shadow-lg shadow-indigo-100"
            >
              <Sparkles className="w-5 h-5" />
              开始 AI 对比分析
            </button>
          </div>
        </div>
      )}

      {/* ── 阶段二：分析中 ── */}
      {phase === 'analyzing' && (
        <div className="mt-16 flex flex-col items-center text-center space-y-6">
          <Loader2 className="w-14 h-14 text-indigo-600 animate-spin" />
          <div>
            <p className="text-lg font-semibold text-[#1d1d1f]">AI 正在对比分析</p>
            <p className="text-sm text-[#86868b] mt-2">{progress || '准备中…'}</p>
          </div>
          <button
            type="button"
            onClick={() => { abortRef.current = true; setPhase('upload'); }}
            className="text-sm text-rose-500 hover:text-rose-600"
          >
            中止并返回
          </button>
        </div>
      )}

      {/* ── 阶段三：报告 ── */}
      {phase === 'report' && analysis && (
        <div className="mt-6 space-y-5">
          {/* 报告顶栏 */}
          <div className="flex items-center justify-between flex-wrap gap-3 bg-white rounded-2xl border border-black/5 px-5 py-3">
            <div className="text-sm text-[#86868b]">
              <span className="font-medium text-[#1d1d1f]">{slots[0]?.name}</span>
              <span className="mx-2">vs</span>
              <span className="font-medium text-[#1d1d1f]">{slots[1]?.name}</span>
            </div>
            <button type="button" onClick={resetAll} className="text-sm text-[#86868b] hover:text-[#1d1d1f] flex items-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> 重新上传
            </button>
          </div>

          {/* Tab */}
          <div className="flex gap-1 bg-[#f5f5f7] p-1 rounded-xl">
            {([
              { id: 'main' as const, label: '主图对比', icon: ImageIcon },
              { id: 'aplus' as const, label: 'A+ 对比', icon: ImageIcon },
              { id: 'bullet' as const, label: '五点对比', icon: FileText },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setReportTab(id)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  reportTab === id ? 'bg-white text-indigo-700 shadow-sm' : 'text-[#86868b] hover:text-[#1d1d1f]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {reportTab === 'main' && (
            <VisualReportTab
              title="主图"
              section={analysis.main}
              slots={slots}
              onDetail={setDetailResult}
            />
          )}
          {reportTab === 'aplus' && (
            <VisualReportTab
              title="A+"
              section={analysis.aplus}
              slots={slots}
              onDetail={setDetailResult}
            />
          )}
          {reportTab === 'bullet' && (
            <BulletReportTab slots={slots} comparison={analysis.bulletComparison} onUpdateBullet={updateSlot} />
          )}
        </div>
      )}

      {/* 图片详解弹窗 */}
      {detailResult && (
        <DetailModal result={detailResult} onClose={() => setDetailResult(null)} />
      )}
    </div>
  );
};

// ─── Step Bar ─────────────────────────────────────────────────────────────────

function StepBar({ current }: { current: number }) {
  const steps = ['上传资料', 'AI 分析', '查看报告'];
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-4">
      {steps.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = n < current;
        return (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                done ? 'bg-indigo-600 text-white' : active ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-600' : 'bg-[#f5f5f7] text-[#86868b]'
              }`}>
                {done ? <CheckCircle2 className="w-4 h-4" /> : n}
              </div>
              <span className={`text-sm hidden sm:inline ${active ? 'font-semibold text-[#1d1d1f]' : 'text-[#86868b]'}`}>{label}</span>
            </div>
            {i < steps.length - 1 && <div className={`w-8 sm:w-16 h-0.5 ${done ? 'bg-indigo-300' : 'bg-black/10'}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Upload Slot ──────────────────────────────────────────────────────────────

function UploadSlot({
  label, slot, loading, inputRef, onUpload, onClear,
}: {
  label: string;
  slot: CompetitorEntry;
  loading: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (f: File | null) => void;
  onClear: () => void;
}) {
  const uploaded = Boolean(slot.zipName);

  if (uploaded) {
    return (
      <div className="bg-white rounded-2xl border border-indigo-100 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[#1d1d1f]">{label}</span>
          <button type="button" onClick={onClear} className="text-xs text-[#86868b] hover:text-rose-500">更换</button>
        </div>
        <div className="flex items-center gap-2 text-emerald-600">
          <CheckCircle2 className="w-5 h-5" />
          <span className="text-sm font-medium">{slot.name}</span>
        </div>
        <div className="flex gap-4 text-sm text-[#86868b]">
          <span>主图 <b className="text-[#1d1d1f]">{slot.mainImages.length}</b></span>
          <span>A+ <b className="text-[#1d1d1f]">{slot.aplusImages.length}</b></span>
          {slot.bulletPoints.trim() && <span>五点 ✓</span>}
        </div>
        <ThumbStrip images={[...slot.mainImages.slice(0, 4), ...slot.aplusImages.slice(0, 4)]} />
      </div>
    );
  }

  return (
    <div className={`relative bg-white rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
      loading ? 'border-indigo-300' : 'border-black/10 hover:border-indigo-300'
    }`}>
      <input
        ref={inputRef}
        type="file"
        accept=".zip"
        className="absolute inset-0 opacity-0 cursor-pointer"
        disabled={loading}
        onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
      />
      {loading ? (
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
      ) : (
        <>
          <p className="font-semibold text-[#1d1d1f] mb-1">{label}</p>
          <Upload className="w-7 h-7 text-indigo-400 mx-auto my-3" />
          <p className="text-sm text-[#86868b]">点击上传 .zip</p>
        </>
      )}
    </div>
  );
}

function ThumbStrip({ images }: { images: ImageFile[] }) {
  if (!images.length) return null;
  return (
    <div className="flex gap-1.5 overflow-hidden">
      {images.map((img) => (
        <img key={img.id} src={img.previewUrl} alt="" className="w-10 h-10 rounded-md object-cover border border-black/5" />
      ))}
    </div>
  );
}

// ─── Visual Report Tab ────────────────────────────────────────────────────────

function VisualReportTab({
  title, section, slots, onDetail,
}: {
  title: string;
  section: SectionResult;
  slots: CompetitorEntry[];
  onDetail: (r: ImageAnalysisResult) => void;
}) {
  const activeSlots = slots.filter((s) => section.perImage.some((r) => r.competitorId === s.id));

  const maxRows = useMemo(() => {
    return Math.max(...activeSlots.map((s) => section.perImage.filter((r) => r.competitorId === s.id).length), 0);
  }, [activeSlots, section.perImage]);

  if (!section.perImage.length && !section.crossComparison) {
    return <EmptyTab message={`暂无${title}分析数据`} />;
  }

  return (
    <div className="space-y-5">
      {/* 结论优先 */}
      {section.crossComparison && (
        <div className="bg-white rounded-2xl border border-black/5 p-6">
          <h3 className="text-base font-semibold text-[#1d1d1f] mb-4">{title} · 对比结论</h3>
          <div className="prose prose-sm max-w-none text-[#1d1d1f]">
            <Markdown remarkPlugins={[remarkGfm]}>{section.crossComparison}</Markdown>
          </div>
        </div>
      )}

      {/* 左右对照 */}
      {maxRows > 0 && (
        <div className="bg-white rounded-2xl border border-black/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-black/5 bg-[#fafafa]">
            <h3 className="text-sm font-semibold text-[#1d1d1f]">{title} · 逐张对照</h3>
          </div>
          <div className="grid grid-cols-2 divide-x divide-black/5">
            {activeSlots.map((slot) => (
              <div key={slot.id} className="p-4">
                <p className="text-sm font-semibold text-center mb-3 text-indigo-700">{slot.name}</p>
              </div>
            ))}
          </div>
          {Array.from({ length: maxRows }).map((_, row) => (
            <div key={row} className="grid grid-cols-2 divide-x divide-black/5 border-t border-black/5">
              {activeSlots.map((slot) => {
                const items = section.perImage.filter((r) => r.competitorId === slot.id);
                const item = items[row];
                return (
                  <div key={slot.id} className="p-4 flex flex-col items-center">
                    {item ? (
                      <CompareCell result={item} index={row} onDetail={() => onDetail(item)} />
                    ) : (
                      <span className="text-xs text-[#c7c7c7] py-8">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CompareCell({ result, index, onDetail }: { result: ImageAnalysisResult; index: number; onDetail: () => void }) {
  const excerpt = result.analysis.replace(/[#*`\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 72);
  return (
    <button type="button" onClick={onDetail} className="w-full group text-left">
      <div className="relative mb-2">
        <img src={result.previewUrl} alt="" className="w-full aspect-square max-w-[200px] mx-auto rounded-xl object-contain bg-[#f5f5f7] border border-black/5" />
        <span className="absolute top-2 left-2 bg-black/60 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
          第 {index + 1} 张
        </span>
        <span className="absolute top-2 right-2 bg-white/90 p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
          <Maximize2 className="w-3.5 h-3.5 text-indigo-600" />
        </span>
      </div>
      <p className="text-xs text-[#86868b] line-clamp-2 leading-relaxed px-1">{excerpt}…</p>
      <p className="text-xs text-indigo-600 font-medium mt-1.5 text-center">查看完整解读 →</p>
    </button>
  );
}

// ─── Bullet Tab ───────────────────────────────────────────────────────────────

function BulletReportTab({
  slots, comparison, onUpdateBullet,
}: {
  slots: CompetitorEntry[];
  comparison: string;
  onUpdateBullet: (idx: number, patch: Partial<CompetitorEntry>) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {slots.map((slot, idx) => (
          <div key={slot.id} className="bg-white rounded-2xl border border-black/5 p-5">
            <p className="text-sm font-semibold text-indigo-700 mb-3">{slot.name}</p>
            <textarea
              value={slot.bulletPoints}
              onChange={(e) => onUpdateBullet(idx, { bulletPoints: e.target.value })}
              placeholder="粘贴或编辑五点文案…"
              className="w-full h-36 text-sm px-3 py-2 rounded-xl border border-black/10 resize-none focus:outline-none focus:border-indigo-400"
            />
          </div>
        ))}
      </div>
      {comparison ? (
        <div className="bg-white rounded-2xl border border-black/5 p-6">
          <h3 className="text-base font-semibold mb-4">五点 · 对比结论</h3>
          <div className="prose prose-sm max-w-none">
            <Markdown remarkPlugins={[remarkGfm]}>{comparison}</Markdown>
          </div>
        </div>
      ) : (
        <EmptyTab message="请为两个竞品都填写五点文案后，重新运行分析" />
      )}
    </div>
  );
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-12 text-center text-sm text-[#86868b]">
      {message}
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ result, onClose }: { result: ImageAnalysisResult; onClose: () => void }) {
  const label = result.category === 'main' ? '主图' : 'A+';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white w-full max-w-4xl max-h-[90vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 shrink-0">
          <div>
            <p className="font-semibold text-[#1d1d1f]">{result.competitorName} · {label} 第 {result.imageIndex + 1} 张</p>
            <p className="text-xs text-[#86868b] mt-0.5">{result.imageName}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-[#f5f5f7] rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 flex flex-col md:flex-row gap-6">
          <img src={result.previewUrl} alt="" className="md:w-72 shrink-0 rounded-xl border object-contain bg-[#f5f5f7]" />
          <div className="prose prose-sm max-w-none flex-1">
            <Markdown remarkPlugins={[remarkGfm]}>{result.analysis}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}
