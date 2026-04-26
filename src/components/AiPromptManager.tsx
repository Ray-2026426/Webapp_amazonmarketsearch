import React, { useState } from 'react';
import { X, Edit3, Save, RotateCcw, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

export interface AiPromptConfig {
  id: string;
  name: string;
  description: string;
  defaultPrompt: string;
  currentPrompt: string;
}

const STORAGE_KEY = 'amzdev_ai_prompts';

/** 与「AI 智能分类」主指令一致，含 MECE 与颗粒度规则 */
export const DEFAULT_SEGMENTATION_PROMPT = `你是一位拥有10年经验的资深亚马逊产品经理和市场数据分析专家，擅长通过自然语言处理（NLP）和语义聚类，从海量非结构化数据中洞察商业机会，并建立清晰的产品矩阵。
核心任务：
我将为你提供一份包含数百至上千条亚马逊产品标题（Titles）的列表。请你对这些标题进行深度的语义分析、关键词提取和逻辑聚类，将这个大盘市场拆解为若干个精准的细分市场（Niche Markets）。
分析框架与规则：
1. 多维度拆解：请综合考虑标题中体现的“核心功能（Function）”、“应用场景（Use Case）”、“目标受众（Target Audience）”、“材质/形态（Material/Form）”或“属性痛点（Pain Points）”进行聚类。
2. MECE原则：各细分市场之间应尽量保持相互独立（Mutually Exclusive），且整体涵盖绝大多数输入的标题（Collectively Exhaustive）。过滤掉无意义的介词和通用营销词汇（如 Best, 2024 New, Sale 等）。
3. 收敛颗粒度：不要分得过细导致碎片化，也不要过于宽泛。请将市场收敛到 3-8 个最具商业代表性的核心细分领域。
4. 语言要求：输出的细分市场名称（segments 数组中的每一项），以及 descriptions 中 people（目标人群）、scenarios（使用场景）、needs（核心诉求与痛点）的全部文字必须使用简体中文，不得使用英文段落或英文标签名作为正文（JSON 键名保持 people、scenarios、needs 即可）。`;

const DEFAULT_PROMPTS: Omit<AiPromptConfig, 'currentPrompt'>[] = [
  { id: 'market_report', name: '市场分析报告', description: '生成整体市场深度分析报告',
    defaultPrompt: '你是一位拥有10年经验的资深亚马逊市场分析专家。\n\n报告结构：\n1. 市场总览\n2. 价格带分析\n3. 头部品牌格局\n4. 细分市场机会\n5. 新品入局建议\n6. 风险提示' },
  { id: 'asin_analysis', name: 'ASIN深度分析', description: '对单个ASIN进行深度分析',
    defaultPrompt: '你是一位资深亚马逊运营专家。\n\n分析维度：\n1. 产品定位解读（基于标题关键词）\n2. 销售趋势分析\n3. 价格策略分析\n4. 竞争力评估\n5. 增长机会与风险\n6. 运营建议（3-5条）' },
  { id: 'segmentation', name: '市场细分 / AI 智能分类', description: '对产品标题进行语义聚类（影响「市场细分」中的 AI 智能分类）',
    defaultPrompt: DEFAULT_SEGMENTATION_PROMPT },
  { id: 'user_insights', name: '用户洞察分析', description: '基于用户评论分析用户画像',
    defaultPrompt: '你是一位消费者行为研究专家。基于以下评论深度分析用户画像。\n\n分析要求：\n1. 目标人群画像\n2. 核心使用场景\n3. 购买动机与核心需求\n4. 痛点与抱怨\n5. 超预期满意点\n6. 产品改进建议' },
  { id: 'keyword_analysis', name: '关键词分析', description: '提炼核心搜索意图和流量机会',
    defaultPrompt: '你是一位亚马逊SEO和PPC专家。\n\n分析维度：\n1. 高价值核心词\n2. 长尾机会词\n3. 用户搜索意图分类\n4. 广告投放建议\n5. 标题和后台关键词优化建议' },
  { id: 'voc_tag_generate', name: 'VOC Step1: 标签库生成', description: '读取评论样本，提炼四维度标签库',
    defaultPrompt: '# Role: 资深电商VOC（用户声音）数据分析师\n\n# Task: 产品评论深度挖掘与高频标签提取\n\n## 1. 任务背景\n我将为你提供一批产品的真实买家评论数据（包含"评论标题"和"评论内容"）。请你仔细阅读这数百条交叉错综的评论，进行深度的数据清洗与语义分析，挖掘出背后的核心诉求、痛点及用户特征。\n\n## 2. 分析维度与输出要求\n请基于我提供的评论数据，严格提炼出以下四个维度的高频标签。每个维度只需输出 3-8个 最核心、出现频率最高的标签。所有内容请使用中文输出。\n\n* 好评点 (Positive Drivers): 促使买家认可产品的核心爽点或体验价值（如：材质耐用、安装简便）。\n* 差评点 (Pain Points): 导致买家抱怨或退货的核心致命缺陷（如：尺寸偏小、存在异味）。\n* 使用场景 (Use Cases): 买家提及的实际使用该产品的具体情境或环境（如：长途驾驶、办公室收纳）。\n* 目标人群 (Target Audience): 从评论中推导出的典型用户画像或购买决策者（如：多猫家庭、新手司机）。\n\n## 3. 输出格式\n（注：请以 JSON 格式返回对应字段）\n{"positive":["标签"],"negative":["标签"],"scenarios":["标签"],"audience":["标签"]}\n\n## 4. 处理规则 (CRITICAL)\n1. 精准聚类：务必将语义相近、指向同一问题的表达合并为一个专业标签。\n2. 客观归纳：严格基于我提供的文本进行提炼，绝不能依靠AI自身的知识库凭空捏造。\n3. 过滤噪音：忽略无意义的情绪宣泄，深挖情绪背后的客观事实原因。' },
  { id: 'voc_tag_label', name: 'VOC Step2: 自动匹配打标', description: '基于标签库，对每条评论进行标签匹配',
    defaultPrompt: '根据【标签项列表】，智能分析每条【用户评论】，判断是否匹配列表中的标签。\n\n规则：\n1. 语义匹配，理解用户表达的情绪和本质\n2. 主动联想同义词、近义词\n3. 一条评论可匹配多个标签\n4. 评论中未出现的内容不要猜测\n\n输出 JSON：\n{"tags":[{"id":0,"positive":[],"negative":[],"scenarios":[],"audience":[]}]}' },
  { id: 'voc_deep_report', name: 'VOC Step3: 深度洞察报告', description: '综合评论数据，生成产品开发深度洞察报告',
    defaultPrompt: '作为资深亚马逊产品开发专家，请基于我提供的评论数据，进行深度用户洞察并输出产品优化方案。要求：\n\n用户画像（50字内）：描述核心使用人群的身份、关键特征。\n使用场景（50字内）：概括最高频、最具体的使用情境和场合。\n核心需求（100字内）：总结用户购买此产品时最看重的1-3个核心价值与功能诉求。\n主要痛点（100字内）：提炼现有产品未能满足用户需求的3-5个主要缺陷与抱怨。\n优化后产品方案（300字内）：针对上述痛点，提出具体的产品改进方案，包括但不限于材质、关键参数、功能设计、包装方式等。\n卖点（200字内）：为优化后的新方案输出主要的核心卖点2-5条。\n\n输出格式：请直接用以下框架回复（并配备图标，字体有着重强调，比如加粗，显得要好看、专业，而不是空洞洞的文字）：\n一、用户画像：\n二、使用场景：\n三、核心需求：\n四、主要痛点：\n五、优化后产品方案：\n六、核心卖点：\n\n备注：分析需严格基于评论数据，结论应客观、可落地。' },
  { id: 'voc_user_journey_5w1h', name: 'VOC Step4: 用户旅程5W1H', description: '基于评论生成各阶段用户旅程5W1H与劣势表',
    defaultPrompt: '作为用户体验研究专家，请严格依据我提供的亚马逊商品评论，分析用户在与该产品互动的全旅程中各阶段（如搜索、浏览、购买、开箱、使用、收纳、售后、评论）的真实体验。请遵循5W1H分析法（Who, Where, When, What, Why, How），从评论中提炼出每个阶段的核心事实，并必须附上1-3条最具代表性的用户评论原句作为佐证。同时，基于负面评论，总结该阶段的“当前方案劣势”及“可能的改进方案”。\n\n请注意：\n\n绝对基于事实： 仅分析评论中明确提及的阶段和细节。如某个阶段（如搜索、浏览）在评论中无迹可寻，则直接忽略该阶段，不得臆想。\n\n输出格式： 请严格按照下表格式输出，一行代表一个旅程阶段的一个发现。\n\n请使用以下表格格式输出：\n\n用户旅程阶段\tWho (谁)\tWhere (在哪)\tWhen (何时)\tWhat (做什么)\tWhy (为何)\tHow (怎么做)\t代表评论原句 (必须提供，并且必须完整，可以有多条)\t当前方案劣势\t可能的改进方案' },
];

export function loadPrompts(): AiPromptConfig[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const savedMap: Record<string, string> = saved ? JSON.parse(saved) : {};
    return DEFAULT_PROMPTS.map(p => ({ ...p, currentPrompt: savedMap[p.id] ?? p.defaultPrompt }));
  } catch {
    return DEFAULT_PROMPTS.map(p => ({ ...p, currentPrompt: p.defaultPrompt }));
  }
}

export function savePromptItem(id: string, prompt: string): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const savedMap: Record<string, string> = saved ? JSON.parse(saved) : {};
    savedMap[id] = prompt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedMap));
  } catch {}
}

export function getPrompt(id: string): string {
  return loadPrompts().find(p => p.id === id)?.currentPrompt ?? '';
}

export function resetPromptToDefault(id: string): void {
  const def = DEFAULT_PROMPTS.find(p => p.id === id);
  if (def) savePromptItem(id, def.defaultPrompt);
}

interface AiPromptManagerProps {
  onClose?: () => void;
  /** 内嵌在 AI 设置等面板中，无全屏遮罩 */
  embedded?: boolean;
}

export const AiPromptManager: React.FC<AiPromptManagerProps> = ({ onClose, embedded }) => {
  const [prompts, setPrompts] = useState<AiPromptConfig[]>(loadPrompts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const handleEdit = (p: AiPromptConfig) => { setEditingId(p.id); setEditText(p.currentPrompt); setExpandedId(p.id); };
  const handleSave = (id: string) => { savePromptItem(id, editText); setPrompts(prev => prev.map(p => p.id === id ? { ...p, currentPrompt: editText } : p)); setEditingId(null); };
  const handleReset = (p: AiPromptConfig) => { savePromptItem(p.id, p.defaultPrompt); setPrompts(prev => prev.map(q => q.id === p.id ? { ...q, currentPrompt: p.defaultPrompt } : q)); if (editingId === p.id) setEditText(p.defaultPrompt); };

  const body = (
    <>
      <div className={`flex items-center justify-between shrink-0 ${embedded ? 'pb-4 border-b border-black/5' : 'p-6 border-b border-black/5 bg-gradient-to-r from-indigo-50 to-violet-50 rounded-t-[24px]'}`}>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 rounded-xl"><Sparkles className="w-5 h-5 text-indigo-600"/></div>
          <div>
            <h2 className="text-lg font-bold text-[#1d1d1f]">{embedded ? 'Prompt 管理' : 'AI Prompt 管理'}</h2>
            <p className="text-xs text-[#86868b]">查看和编辑各 AI 功能的提示词（含市场细分指令）</p>
          </div>
        </div>
        {!embedded && onClose && (
          <button type="button" onClick={onClose} className="p-2 hover:bg-black/5 rounded-full"><X className="w-5 h-5 text-[#86868b]"/></button>
        )}
      </div>
      <div className={`flex-1 overflow-y-auto space-y-3 min-h-0 ${embedded ? 'py-4 pr-1' : 'p-6'}`}>
        {prompts.map(p => (
          <div key={p.id} className="border border-black/5 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-white">
              <button type="button" className="flex-1 flex items-center gap-3 text-left" onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}>
                <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0"/>
                <div><div className="text-sm font-semibold text-[#1d1d1f]">{p.name}</div><div className="text-xs text-[#86868b]">{p.description}</div></div>
                {expandedId === p.id ? <ChevronUp className="w-4 h-4 text-[#86868b] ml-auto shrink-0"/> : <ChevronDown className="w-4 h-4 text-[#86868b] ml-auto shrink-0"/>}
              </button>
              <div className="flex items-center gap-2 ml-3">
                {editingId === p.id
                  ? <button type="button" onClick={() => handleSave(p.id)} className="flex items-center gap-1 px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-semibold"><Save className="w-3 h-3"/> 保存</button>
                  : <button type="button" onClick={() => handleEdit(p)} className="flex items-center gap-1 px-3 py-1 bg-[#f5f5f7] text-[#1d1d1f] rounded-lg text-xs font-medium"><Edit3 className="w-3 h-3"/> 编辑</button>}
                <button type="button" onClick={() => handleReset(p)} className="flex items-center gap-1 px-3 py-1 bg-[#f5f5f7] text-[#86868b] rounded-lg text-xs font-medium hover:bg-rose-50 hover:text-rose-600"><RotateCcw className="w-3 h-3"/> 重置</button>
              </div>
            </div>
            {expandedId === p.id && (
              <div className="px-4 pb-4 bg-[#fafafa]">
                {editingId === p.id
                  ? <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={embedded ? 8 : 10} className="w-full text-sm bg-white border border-indigo-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y font-mono leading-relaxed mt-2"/>
                  : <pre className="text-xs text-[#86868b] bg-white border border-black/5 rounded-xl p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto mt-2">{p.currentPrompt}</pre>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={`shrink-0 p-4 border-t border-black/5 bg-[#fafafa] ${embedded ? 'rounded-b-xl' : 'rounded-b-[24px]'}`}>
        <p className="text-xs text-[#86868b] text-center">单条 Prompt 点「保存」后写入本地。点「重置」恢复该条默认文案。</p>
      </div>
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col min-h-0 flex-1 max-h-[min(52vh,520px)]">
        {body}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col min-h-0">
        {body}
      </div>
    </div>
  );
};
