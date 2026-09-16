import React, { useState, useEffect } from 'react';
import { X, Sparkles, Key, Check, AlertCircle, Cpu, FileText, Globe, CloudDownload, ToggleLeft, UserRound, ShieldCheck, Users, RefreshCw, Loader2 } from 'lucide-react';
import {
  AI_PROVIDERS,
  AiProvider,
  AiSettings,
  getProviderConfig,
  getEffectiveModels,
  buildEndpoint,
  resolveCustomApiUrl,
  isBareDomainUrl,
  suggestFullApiUrl,
  generateText,
  fetchAvailableModels,
  sanitizeAiApiUrls,
} from '../utils/aiConfig';
import { planModelsRequest } from '../utils/aiModels';
import {
  loadMcpSettings,
  saveMcpSettings,
  loadFeatureFlags,
  saveFeatureFlags,
  createSellerSpriteProvider,
  createXydcProvider,
  createLingXingProvider,
  createSorftimeProvider,
  createCustomProvider,
  type McpProviderEntry,
  type AppFeatureFlags,
} from '../utils/mcpConfig';
import {
  loadUserBackground,
  saveUserBackground,
  EMPTY_USER_BACKGROUND,
  BACKGROUND_GROUPS,
  applyBackgroundMultiChange,
  computeBackgroundCompleteness,
  describeBackgroundCompleteness,
  getBackgroundFieldValue,
  getBackgroundMultiValue,
  setBackgroundFieldValue,
  weakestBackgroundGroup,
  type UserBackgroundProfile,
} from '../utils/userBackground';
import { verifyDataPoolProvider } from '../utils/dataPoolClient';
import { maskKey } from '../utils/keyMasking';
import { toast } from 'sonner';
import { AiPromptManager } from './AiPromptManager';
import { SystemDiagnosticsPanel } from './SystemDiagnosticsPanel';
import { AdminConsolePanel } from './AdminConsolePanel';
import { TeamSettingsPanel } from './TeamSettingsPanel';
import { getCurrentUser, isAdminSession } from '../utils/auth';
import {
  decideAiTransport,
  providerEndpointFact,
  providerRequiresCustomUrl,
} from '../utils/aiEndpoints';
import { Select, MultiSelectChips } from './ui/Select';
import { BrandDetailSheet, BrandListEditor } from './BrandDetailSheet';
import { InfoTip } from './ui/InfoTip';

type SettingsTab = 'api' | 'profile' | 'mcp' | 'features' | 'prompts' | 'diagnostics' | 'admin' | 'team';

/**
 * 数据源地址输入框的占位提示。
 * 抽成函数是为了让"MCP 面板里每个数据源的 名称/地址/Key/验证 四样"保持**同一段 JSX**渲染：
 * 一旦在行内按 kind 写三元分支，就很容易演变成"某一类数据源又没有 Key 输入框"。
 */
function mcpUrlPlaceholder(kind: McpProviderEntry['kind']): string {
  return kind === 'custom' ? 'https://your-mcp.example.com/mcp' : '留空 = 走应用内安全代理';
}

/** 数据源角标文案（同样抽出来，保证行内那四样是同一段 JSX，不掺任何 kind 分支） */
function mcpKindLabel(kind: McpProviderEntry['kind']): string {
  if (kind === 'sellersprite') return '卖家精灵';
  if (kind === 'xydc') return '西柚洞察';
  if (kind === 'lingxing') return '领星';
  if (kind === 'sorftime') return 'Sorftime';
  return '自定义';
}

function sanitizeBuiltinMcpUrl(kind: McpProviderEntry['kind'], url: string): string {
  const v = url.trim();
  if (kind === 'custom') return v;
  if (!v) return '';
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return '';
  if (/mcp\.sellersprite\.com/i.test(v)) return '';
  if (/mcp\.xydc\.com/i.test(v)) return '';
  if (/openmcp\.lingxing\.com/i.test(v) || /mcp\.lingxing\.com/i.test(v)) return '';
  if (/mcp\.sorftime\.com/i.test(v)) return '';
  return v;
}

interface AiSettingsPanelProps {
  settings: AiSettings | null;
  onSave: (settings: AiSettings) => void;
  onClose: () => void;
  /** 功能开关变更时同步到主界面（如市场准入评估显隐） */
  onFeatureFlagsChange?: (flags: AppFeatureFlags) => void;
}

export const AiSettingsPanel: React.FC<AiSettingsPanelProps> = ({
  settings,
  onSave,
  onClose,
  onFeatureFlagsChange,
}) => {
  const initialProvider = settings?.provider ?? 'deepseek';
  const initialCfg = getProviderConfig(initialProvider);
  const initialModels = getEffectiveModels(settings ?? { provider: initialProvider, apiKey: '', model: '' }, initialProvider);
  const initialModel = settings?.model && initialModels.includes(settings.model)
    ? settings.model
    : initialCfg.defaultModel;

  const [tab, setTab] = useState<SettingsTab>('api');
  const [provider, setProvider] = useState<AiProvider>(initialProvider);
  const [model, setModel] = useState<string>(initialModel);
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? '');
  const [apiUrls, setApiUrls] = useState<Partial<Record<AiProvider, string>>>(sanitizeAiApiUrls(settings?.apiUrls) ?? {});
  /** 允许浏览器直连（Key 不经过本站服务端）；见 AiSettings.allowBrowserDirect */
  const [allowBrowserDirect, setAllowBrowserDirect] = useState(settings?.allowBrowserDirect === true);
  const [customModels, setCustomModels] = useState<Partial<Record<AiProvider, string[]>>>(settings?.customModels ?? {});
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  /** 「获取模型」：正在拉取 / 拉到的模型 / 失败原因（三者都在 hook 区，避免 hook 顺序问题） */
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState('');

  const [mcpProviders, setMcpProviders] = useState<McpProviderEntry[]>(() => {
    const loaded = loadMcpSettings().providers;
    return loaded.map((p) => ({
      ...p,
      mcpUrl: sanitizeBuiltinMcpUrl(p.kind, p.mcpUrl),
    }));
  });
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  /** 每个数据源上一次「验证」的结果：状态 + 一句人话（含"用的谁的 Key"） */
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, { state: 'ok' | 'fail'; note: string }>>({});

  const [featureFlags, setFeatureFlags] = useState<AppFeatureFlags>(() => loadFeatureFlags());
  const [userBackground, setUserBackground] = useState<UserBackgroundProfile>(() => loadUserBackground());
  /** 品牌列表里"就地展开"的品牌 id（内联形态，与全屏页共用同一个区块组件） */
  const [openBrandId, setOpenBrandId] = useState<string | null>(null);
  /** 全屏品牌资产页打开的品牌 id（复用 L3 页壳的形态） */
  const [sheetBrandId, setSheetBrandId] = useState<string | null>(null);

  useEffect(() => {
    const p = settings?.provider ?? 'deepseek';
    const cfg = getProviderConfig(p);
    const allModels = getEffectiveModels(settings ?? { provider: p, apiKey: '', model: '' }, p);
    const m =
      settings?.model && allModels.includes(settings.model)
        ? settings.model
        : cfg.defaultModel;
    setProvider(p);
    setModel(m);
    setApiKey(settings?.apiKey ?? '');
    setApiUrls(sanitizeAiApiUrls(settings?.apiUrls) ?? {});
    setCustomModels(settings?.customModels ?? {});
    setTestResult(null);
  }, [settings]);

  const cfg = getProviderConfig(provider);
  const currentApiUrl = apiUrls[provider] ?? '';
  const currentCustomModels = customModels[provider] ?? [];

  const handleProviderChange = (p: AiProvider) => {
    const nextCfg = getProviderConfig(p);
    const nextAllModels = [
      ...nextCfg.models,
      ...(customModels[p] ?? []),
    ];
    setProvider(p);
    setModel((prev) => (nextAllModels.includes(prev) ? prev : nextCfg.defaultModel));
    setTestResult(null);
  };



  /**
   * 「获取模型」：用当前 Key 去问供应商有哪些可用模型，拉回来直接选。
   * 通道由 `planModelsRequest` 决定（内置供应商走同源代理；填了绝对地址则经本站服务端转发，
   * 否则浏览器直连会被跨域拦住）。切供应商/切地址时清空上次结果，避免张冠李戴。
   */
  const handleFetchModels = async () => {
    const key = apiKey.trim();
    if (!key) {
      toast.error('请先填写 API Key');
      return;
    }
    setFetchingModels(true);
    setModelsError('');
    setFetchedModels([]);
    try {
      const res = await fetchAvailableModels({
        provider,
        apiKey: key,
        model,
        apiUrls,
        customModels,
        allowBrowserDirect,
      });
      if (!res.ok) {
        setModelsError(res.error);
        toast.error('没能取到模型列表，可手动填写模型名');
        return;
      }
      setFetchedModels(res.models);
      toast.success(`取到 ${res.models.length} 个可用模型，点一个即选中`);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleTest = async () => {
    if (!apiKey.trim()) { toast.error('请先填写 API Key'); return; }

    setIsTesting(true);
    setTestResult(null);
    try {
      const tmp: AiSettings = {
        provider,
        apiKey: apiKey.trim(),
        model,
        apiUrls,
        customModels,
        allowBrowserDirect,
      };
      await generateText('你好，请回复"ok"', tmp);
      setTestResult('ok');
      toast.success('API Key 验证成功！');
    } catch (e: any) {
      setTestResult('fail');
      const testSettings: AiSettings = { provider, apiKey: apiKey.trim(), model, apiUrls, customModels };
      let endpointUrl = '(未知)';
      try { endpointUrl = buildEndpoint(testSettings, provider); } catch {}
      toast.error(
        `验证失败：${e?.message ?? '未知错误'}\n\n请求地址：${endpointUrl}`
      );
    } finally {
      setIsTesting(false);
    }
  };

  const updateProvider = (id: string, patch: Partial<McpProviderEntry>) => {
    setMcpProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setMcpTestResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  /**
   * 「验证」：**按密钥来源分别验证**（BYO Key，2026-09 用户决策变更）。
   *
   * 与旧实现的区别（旧实现是"假验证"）：以前这里调 `testMcpProvider` → `checkDataPoolReady`，
   * 它只查"服务端数据池配没配卖家精灵"——既不看你在界面上填了什么，也不看是哪个数据源。
   * 现在统一走 `verifyDataPoolProvider`（→ 网关 `/api/data/verify`）：
   *   - 本机填了自己的 Key → 网关用**你的** Key 做一次 MCP 握手；
   *   - 没填 → 用平台 Key 握手，并如实告诉用户"这次用的是平台 Key"；
   *   - 只握手，不调业务工具、不记用量、不占配额。
   * 明文 Key 只在这一次同源请求的**请求体**里出现（绝不进 URL query、不进日志、不进返回体）。
   */
  const handleTestMcpProvider = async (provider: McpProviderEntry) => {
    if (provider.kind === 'custom' && !provider.mcpUrl.trim()) {
      toast.error('自定义 MCP 需要填写地址');
      return;
    }
    setTestingProviderId(provider.id);
    try {
      const result = await verifyDataPoolProvider({
        provider: provider.kind,
        endpoint: provider.kind === 'custom' ? provider.mcpUrl : undefined,
      });
      setMcpTestResults((prev) => ({ ...prev, [provider.id]: { state: result.ok ? 'ok' : 'fail', note: result.message } }));
      if (result.ok) toast.success(`「${provider.name}」${result.message}`);
      else toast.error(`「${provider.name}」${result.message}`);
    } catch (e: unknown) {
      const note = e instanceof Error ? e.message : '未知错误';
      setMcpTestResults((prev) => ({ ...prev, [provider.id]: { state: 'fail', note } }));
      toast.error(`验证失败：${note}`);
    } finally {
      setTestingProviderId(null);
    }
  };

  const persistMcp = () => {
    const ss = mcpProviders.find((p) => p.kind === 'sellersprite') || mcpProviders[0];
    saveMcpSettings({
      secretKey: ss?.secretKey || '',
      mcpUrl: ss?.mcpUrl || '',
      providers: mcpProviders,
    });
  };

  const persistProfile = () => {
    saveUserBackground(userBackground);
  };

  const persistFeatures = (next: AppFeatureFlags) => {
    setFeatureFlags(next);
    saveFeatureFlags(next);
    onFeatureFlagsChange?.(next);
  };

  const handleSave = () => {
    persistMcp();
    persistProfile();
    saveFeatureFlags(featureFlags);
    onFeatureFlagsChange?.(featureFlags);

    if (tab === 'mcp' || tab === 'features' || tab === 'profile') {
      const msg =
        tab === 'mcp' ? 'MCP 设置已保存' :
        tab === 'profile' ? '背景信息已保存，后续 AI 分析会参考这些信息' :
        '功能开关已保存';
      toast.success(msg);
      onClose();
      return;
    }

    if (!apiKey.trim()) {
      toast.error('请填写 AI API Key，或切换到「背景信息 / MCP 数据」页单独应用');
      return;
    }
    const cleanedApiUrls = sanitizeAiApiUrls(apiUrls);
    onSave({
      provider,
      apiKey: apiKey.trim(),
      model,
      apiUrls: cleanedApiUrls,
      customModels,
      allowBrowserDirect,
    });
    toast.success('设置已保存');
    onClose();
  };

  const trimmedApiUrl = currentApiUrl.trim().replace(/\/+$/, '');
  const resolvedApiUrl = trimmedApiUrl ? resolveCustomApiUrl(currentApiUrl, provider) : '';
  const urlWillAutoComplete = Boolean(trimmedApiUrl && resolvedApiUrl !== trimmedApiUrl);
  const urlLooksIncomplete = Boolean(trimmedApiUrl && isBareDomainUrl(currentApiUrl));
  const suggestedApiUrl = trimmedApiUrl ? suggestFullApiUrl(currentApiUrl, provider) : '';

  /**
   * 请求地址的"说真话"区块（用户诉求：默认要对应大模型的地址、可以改、能接第三方中转）。
   * 三个事实必须同屏可见，否则用户根本不知道自己的请求会打到哪里：
   * 1. 厂商官方地址；
   * 2. **本站默认转发实际会打到的地址**（内置 8 个里 7 个是官方，DeepSeek 是第三方中转 openrouter.fans）；
   * 3. 这次请求实际走哪条通道（同源代理 / 服务端转发 / 浏览器直连）与原因。
   */
  const endpointFact = providerEndpointFact(provider);
  const isCustomProvider = providerRequiresCustomUrl(provider);
  const defaultIsNotOfficial = !isCustomProvider && endpointFact.proxyTarget !== endpointFact.officialUrl;
  /** 取模型列表这次请求会怎么发（同源代理 / 服务端转发），用于给用户一句人话说明 */
  const modelPlan = planModelsRequest({ provider, customBaseUrl: currentApiUrl });
  const transport = decideAiTransport({ customUrl: currentApiUrl });
  const transportLabel: Record<string, string> = {
    proxy: '本站同源转发（默认）',
    relay: '经本站服务端转发',
    direct: '浏览器直连',
  };
  const effectiveAddress = trimmedApiUrl
    ? urlLooksIncomplete
      ? resolvedApiUrl || suggestedApiUrl
      : resolvedApiUrl || trimmedApiUrl
    : `${endpointFact.proxyTarget}（本站默认转发目标）`;

  /** 背景信息完整度（确定性纯函数；只影响"可信度"，不进入任何评分公式，权重固定 25/25/25/15/10） */
  const bgReport = computeBackgroundCompleteness(userBackground);
  /** 全屏品牌资产页要展示的品牌（找不到就当作没打开，不渲染空页） */
  const sheetBrand = userBackground.brands.find((b) => b.id === sheetBrandId) ?? null;
  const bgWeak = weakestBackgroundGroup(bgReport);

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'api', label: 'API 与模型', icon: <Cpu className="w-4 h-4" /> },
    { id: 'profile', label: '背景信息', icon: <UserRound className="w-4 h-4" /> },
    { id: 'mcp', label: 'MCP 数据', icon: <CloudDownload className="w-4 h-4" /> },
    { id: 'features', label: '功能开关', icon: <ToggleLeft className="w-4 h-4" /> },
    { id: 'prompts', label: 'Prompt', icon: <FileText className="w-4 h-4" /> },
    { id: 'diagnostics', label: '诊断', icon: <ShieldCheck className="w-4 h-4" /> },
    // M5：管理员后台（仅管理员显示；非管理员即使手动切到该 tab 也只会看到一句说明）
    // 注意：必须传 getCurrentUser()。以前这里写的是 isAdminSession(undefined)，
    // 而 isAdminSession 第一个判断就是 Boolean(user) → 永远 false，导致这两个 Tab 对**所有人**都不显示。
    ...(isAdminSession(getCurrentUser()) ? [{ id: 'admin' as SettingsTab, label: '管理员后台', icon: <ShieldCheck className="w-4 h-4" /> }] : []),
    // M6：团队空间（仅管理员可管理团队与成员）
    ...(isAdminSession(getCurrentUser()) ? [{ id: 'team' as SettingsTab, label: '团队空间', icon: <Users className="w-4 h-4" /> }] : []),
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4">
      <div className="bg-white w-full max-w-3xl rounded-[24px] shadow-2xl animate-in fade-in zoom-in-95 duration-200 h-[min(90vh,880px)] max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-black/5 flex items-center justify-between bg-[#f5f5f7]/50 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-[#1d1d1f]">设置</h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors">
            <X className="w-5 h-5 text-[#86868b]" />
          </button>
        </div>

        <div className="px-6 pt-4 shrink-0">
          <div className="flex gap-1 p-1 bg-[#f5f5f7] rounded-xl overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`flex-1 min-w-[5.5rem] flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                  tab === t.id
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-[#86868b] hover:text-[#1d1d1f]'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 flex-1 min-h-0 flex flex-col overflow-hidden">
          {tab === 'api' && (
            <div className="space-y-5 overflow-y-auto">
              {/* ① 选供应商 */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-[#1d1d1f]">选 AI 供应商</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {AI_PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleProviderChange(p.id)}
                      className={`px-3 py-2.5 rounded-xl border text-sm font-medium transition-all text-left ${
                        provider === p.id
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200'
                          : 'bg-white text-[#1d1d1f] border-black/10 hover:border-indigo-300 hover:bg-indigo-50'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* ② 填 Key（放在模型前面：没有 Key 就没法获取模型） */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-[#1d1d1f] flex items-center gap-2">
                  <Key className="w-4 h-4 text-indigo-600" />
                  API Key
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
                    placeholder={cfg.apiKeyPlaceholder}
                    className="flex-1 px-4 py-2.5 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={isTesting}
                    className="px-4 py-2.5 bg-white border border-black/10 rounded-xl text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors disabled:opacity-50 whitespace-nowrap flex items-center gap-2"
                  >
                    {isTesting ? (
                      <span className="animate-spin">⟳</span>
                    ) : testResult === 'ok' ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : testResult === 'fail' ? (
                      <AlertCircle className="w-4 h-4 text-rose-500" />
                    ) : null}
                    {isTesting ? '验证中...' : '验证'}
                  </button>
                </div>
                <p className="text-[11px] text-[#86868b]">
                  去{' '}
                  <a
                    href={{
                      gemini: 'https://aistudio.google.com/apikey',
                      openai: 'https://platform.openai.com/api-keys',
                      claude: 'https://console.anthropic.com/keys',
                      deepseek: 'https://platform.deepseek.com/api_keys',
                      qwen: 'https://dashscope.console.aliyun.com/apiKey',
                      moonshot: 'https://platform.moonshot.cn/console/api-keys',
                      zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
                      doubao: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
                    }[provider]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    {cfg.name} 控制台
                  </a>{' '}
                  拿 Key；只存在你的浏览器里。
                </p>
              </div>

              {/* 用户要求：不要步骤编号；按钮放在"模型名"前面（获取模型 / 验证 → 再选模型） */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-[#1d1d1f]">模型</label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !apiKey.trim()}
                    title={!apiKey.trim() ? '请先填 API Key' : '用这个 Key 去问供应商有哪些可用模型'}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {fetchingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {fetchingModels ? '获取中…' : '获取模型'}
                  </button>
                  <button
                    type="button"
                    onClick={handleTest}
                    disabled={isTesting || !apiKey.trim()}
                    title={!apiKey.trim() ? '请先填 API Key' : '用当前 Key 发一次真实请求，确认能不能用'}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      testResult === 'ok'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : testResult === 'fail'
                          ? 'border-rose-200 bg-rose-50 text-rose-700'
                          : 'border-black/10 bg-white text-[#424245] hover:border-indigo-300 hover:text-indigo-700'
                    }`}
                  >
                    {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : testResult === 'ok' ? <Check className="w-3.5 h-3.5" /> : testResult === 'fail' ? <AlertCircle className="w-3.5 h-3.5" /> : null}
                    {isTesting ? '验证中…' : testResult === 'ok' ? '验证通过' : testResult === 'fail' ? '验证失败' : '验证'}
                  </button>
                  {!apiKey.trim() && <span className="text-[11px] text-[#86868b]">先填 Key，再点上面两个按钮</span>}
                </div>

                {modelsError && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl">
                    <p className="text-[11px] text-rose-800 break-all leading-relaxed">{modelsError}</p>
                  </div>
                )}

                {fetchedModels.length > 0 && (
                  <div className="p-2.5 bg-[#f5f5f7] rounded-xl border border-black/5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold text-[#1d1d1f]">可用模型（{fetchedModels.length} 个，点一个即选中）</p>
                      <button
                        type="button"
                        onClick={() => {
                          const merged = Array.from(new Set([...currentCustomModels, ...fetchedModels]));
                          setCustomModels((prev) => ({ ...prev, [provider]: merged }));
                          toast.success(`已把 ${fetchedModels.length} 个模型加入可选列表`);
                        }}
                        className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 whitespace-nowrap"
                      >
                        全部加入可选列表
                      </button>
                    </div>
                    <div className="max-h-44 overflow-y-auto flex flex-wrap gap-1.5">
                      {fetchedModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            setModel(m);
                            setCustomModels((prev) => ({
                              ...prev,
                              [provider]: Array.from(new Set([...(prev[provider] ?? []), m])),
                            }));
                            setTestResult(null);
                            toast.success(`已选择模型：${m}`);
                          }}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                            model === m
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-[#1d1d1f] border-black/10 hover:border-indigo-300 hover:bg-indigo-50'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[11px] text-[#86868b] shrink-0">当前使用</span>
                  <Select
                    value={model}
                    onChange={(v) => { setModel(v); setTestResult(null); }}
                    options={cfg.models.map((m) => ({ value: m, label: m }))}
                    groups={
                      currentCustomModels.length > 0
                        ? [{
                            label: '已获取 / 自定义模型',
                            options: currentCustomModels.map((m) => ({ value: m, label: m })),
                          }]
                        : undefined
                    }
                    size="md"
                    className="flex-1 min-w-[12rem]"
                    aria-label="模型"
                  />
                </div>
              </div>

              {/* 高级：默认收起。绝大多数人这一辈子都不用打开。 */}
              <details className="rounded-xl border border-black/5 bg-[#f5f5f7] px-3 py-2.5">
                <summary className="text-xs font-semibold text-[#424245] cursor-pointer select-none">
                  高级设置（接第三方中转、或想改请求地址时才用）
                </summary>
                <div className="space-y-4 pt-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#1d1d1f]">API 请求地址</label>
                    <p className="text-[11px] text-[#86868b] leading-relaxed">
                      {isCustomProvider
                        ? '自定义 / 第三方中转必须填：Base URL（如 https://你的中转/v1），按 OpenAI 兼容发送。'
                        : <>留空即走官方地址 <code className="font-mono">{endpointFact.officialUrl}</code>（本站同源转发，不受浏览器跨域限制）。</>}
                    </p>
                    <input
                      type="text"
                      value={currentApiUrl}
                      onChange={(e) => {
                        setApiUrls(prev => ({ ...prev, [provider]: e.target.value }));
                        setTestResult(null);
                      }}
                      placeholder={isCustomProvider ? 'https://你的中转域名/v1' : '留空 = 官方地址'}
                      className="w-full px-3 py-2 bg-white border border-black/10 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      {trimmedApiUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setApiUrls((prev) => ({ ...prev, [provider]: '' }));
                            setTestResult(null);
                            toast.success('已清空：恢复使用默认地址');
                          }}
                          className="px-2.5 py-1 bg-white border border-black/10 rounded-lg text-[11px] font-semibold text-[#424245] hover:border-indigo-300 hover:text-indigo-700 transition-colors"
                        >
                          恢复默认（清空）
                        </button>
                      )}
                      <span className="text-[11px] text-[#86868b]">
                        实际请求：<code className="font-mono break-all">{effectiveAddress}</code>
                      </span>
                    </div>

                    {defaultIsNotOfficial && !trimmedApiUrl && (
                      <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-relaxed">
                        注意：该供应商本站默认转发到 <code className="font-mono">{endpointFact.proxyTarget}</code>（第三方中转），
                        不是官方地址。点「恢复默认」后用官方地址：
                        <button
                          type="button"
                          onClick={() => {
                            setApiUrls((prev) => ({ ...prev, [provider]: endpointFact.officialUrl }));
                            setTestResult(null);
                            toast.success('已改用官方地址');
                          }}
                          className="ml-1 font-semibold text-amber-900 underline"
                        >
                          改用官方地址
                        </button>
                      </p>
                    )}

                    {urlWillAutoComplete && !urlLooksIncomplete && (
                      <p className="text-[11px] text-[#86868b]">
                        会补全为：<code className="font-mono break-all">{resolvedApiUrl}</code>
                      </p>
                    )}
                    {urlLooksIncomplete && (
                      <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5">
                        <p className="text-[11px] text-amber-800">
                          这像是网站首页而不是 API 地址，建议改成：<code className="font-mono break-all">{suggestedApiUrl}</code>
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setApiUrls(prev => ({ ...prev, [provider]: suggestedApiUrl }));
                            setTestResult(null);
                            toast.success('已补全为标准 API 路径');
                          }}
                          className="px-2.5 py-1 bg-amber-600 text-white rounded-lg text-[11px] font-semibold hover:bg-amber-700 transition-colors"
                        >
                          一键补全路径
                        </button>
                      </div>
                    )}

                    {(trimmedApiUrl.startsWith('http://') || trimmedApiUrl.startsWith('https://')) && (
                      <label className="flex items-start gap-2 pt-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allowBrowserDirect}
                          onChange={(e) => {
                            setAllowBrowserDirect(e.target.checked);
                            setTestResult(null);
                          }}
                          className="mt-0.5 w-3.5 h-3.5 accent-indigo-600"
                        />
                        <span className="text-[11px] text-[#424245] leading-relaxed">
                          浏览器直连（我的接口允许跨域）：勾选后请求与 Key <b>不经过本站服务端</b>；
                          不勾则由服务端代发（更稳，适合不允许跨域的中转）。
                        </span>
                      </label>
                    )}
                  </div>

                </div>
              </details>
            </div>
          )}

          {tab === 'profile' && (
            <div className="space-y-4 overflow-y-auto">
              {/* 2026-09 用户要求：大段说明占地方，全部删除，只留一句以内的短提示。
                  被删掉的是三处：①「以选择题为主、每一组都写明影响哪个判断」那段总说明；
                  ②「填得越全…问题就越少…留空不阻塞分析…信息只保存在本机浏览器」那段（原文见 PRD §15.23）；
                  ③ 完整度那一行的长句（原样形如「背景信息完整度 27/29：已足够可信」）。
                  注意②不只是啰嗦：本轮之后「看自己」固定只问 3 个拍板问题，背景信息填多填少都不会减少题量，
                  所以"问题就越少"这句是**不准确的**，已从 describeBackgroundCompleteness() 里一并去掉。
                  每一组的「影响哪个判断」也改成角标（<details> 点开才显示），不再平铺成长段。 */}

              {/* 完整度（确定性；只影响可信度，不影响任何打分权重） */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    bgReport.fraction >= 0.8 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  背景信息完整度 {bgReport.filled}/{bgReport.total}
                </span>
                <span className="text-[11px] text-[#86868b] leading-relaxed">
                  {describeBackgroundCompleteness(bgReport)}
                  {bgWeak ? ` · 建议先补「${bgWeak.title}」（还差 ${bgWeak.empty} 项）` : ''}
                </span>
              </div>

              {BACKGROUND_GROUPS.map((g) => (
                <div key={g.id} className="rounded-2xl border border-black/8 bg-white p-4 space-y-3">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <p className="text-xs font-bold text-[#1d1d1f]">{g.title}</p>
                        {/* 角标：默认只占一行小字，点开才展开"影响哪个判断"（用户明确要求不要平铺成长段） */}
                        <details className="inline-block align-baseline">
                          <summary className="cursor-pointer list-none rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100">
                            影响哪个判断
                          </summary>
                          <p className="mt-1 text-[11px] text-indigo-700/80 leading-relaxed">{g.affects}</p>
                        </details>
                      </div>
                      <span className="text-[10px] text-[#86868b]">
                        {bgReport.byGroup[g.id].filled}/{bgReport.byGroup[g.id].total} 已填
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {g.fields.map((f) => (
                      <div
                        key={f.key}
                        className={f.kind === 'multi' || f.kind === 'list' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}
                      >
                        <div className="flex flex-wrap items-baseline gap-1.5">
                          <label className="text-xs font-semibold text-[#86868b]">
                            {f.label}
                            {f.hint && <span className="ml-1 font-normal text-[10px] text-[#aeaeb2]">{f.hint}</span>}
                          </label>
                          {/* 字段级的"影响哪个判断"同样收进角标：点击才展开，且是**正文里的可访问文本**
                              （不用原生 title 属性——不能换行、触屏/键盘用户看不到，另一个改动已把这条列为反模式） */}
                          <details className="inline-block align-baseline">
                            <summary className="cursor-pointer list-none rounded-full bg-[#f5f5f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#86868b] hover:text-indigo-700">
                              影响
                            </summary>
                            <p className="mt-1 text-[11px] text-indigo-700/80 leading-relaxed">{f.affects}</p>
                          </details>
                        </div>
                        {f.kind === 'list' ? (
                          /* 品牌名：可添加多个；点开某个品牌就地填商标/备案/品牌资产，也可以全屏打开（同一份实现） */
                          <BrandListEditor
                            brands={userBackground.brands}
                            onChange={(next) => setUserBackground((prev) => ({ ...prev, brands: next }))}
                            openBrandId={openBrandId}
                            onToggleOpen={(id) => setOpenBrandId((prev) => (prev === id ? null : id))}
                            onOpenSheet={(id) => setSheetBrandId(id)}
                          />
                        ) : f.kind === 'select' ? (
                          <Select
                            value={String(getBackgroundFieldValue(userBackground, f.key) ?? '')}
                            onChange={(v) => setUserBackground((prev) => setBackgroundFieldValue(prev, f.key, v))}
                            options={[{ value: '', label: '未填（可留空）' }, ...(f.options ?? [])]}
                            className="w-full"
                            triggerClassName="w-full"
                            aria-label={f.label}
                          />
                        ) : f.kind === 'multi' ? (
                          <MultiSelectChips
                            options={f.options ?? []}
                            value={getBackgroundMultiValue(userBackground, f.key)}
                            onChange={(next) => setUserBackground((prev) => applyBackgroundMultiChange(prev, f.key, next))}
                          />
                        ) : (
                          <input
                            type="text"
                            value={String(getBackgroundFieldValue(userBackground, f.key) ?? '')}
                            onChange={(e) => setUserBackground((prev) => setBackgroundFieldValue(prev, f.key, e.target.value))}
                            placeholder={f.placeholder}
                            className="w-full px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => {
                  setUserBackground({ ...EMPTY_USER_BACKGROUND, fields: {}, notes: {}, brands: [], legacyNotes: '' });
                  toast.info('已清空表单，点「应用设置」后才会真正清除');
                }}
                className="text-xs text-[#86868b] hover:text-rose-600"
              >
                清空背景信息表单
              </button>

              {/* 品牌资产全屏页：复用项目既有的 L3 页壳（返回 / Escape / 四句契约），正文与内联同一份实现 */}
              {sheetBrand && (
                <BrandDetailSheet
                  brand={sheetBrand}
                  brands={userBackground.brands}
                  onChange={(next) => setUserBackground((prev) => ({ ...prev, brands: next }))}
                  onClose={() => setSheetBrandId(null)}
                />
              )}
            </div>
          )}

          {tab === 'mcp' && (
            <div className="space-y-4 overflow-y-auto">
              {/*
                用户决策变更（2026-09 原话："需要其他用户也能填 key，后续我们再考虑做付费，
                那时候再关闭 mcp 入口，换成计费模式。"）：
                旧的「决策 A（浏览器不保存任何密钥、密钥只在服务端）」被推翻 —— 现在**每个数据源**
                （卖家精灵 / 西柚洞察 / 领星 / Sorftime / 自定义）都有 名称 / 地址 / Key / 验证 四样。
                Key 留空 = 用服务端平台 Key（团队共享）；填了 = 用你自己的，**只存在本机浏览器**。
              */}
              <p className="text-xs text-[#86868b] leading-relaxed">
                你自己的 Key 只存在本机浏览器，不上传服务器保存。
              </p>

              <div className="space-y-2">
                {mcpProviders.map((p) => {
                  const testState = mcpTestResults[p.id];
                  const isTesting = testingProviderId === p.id;
                  const hasOwnKey = Boolean(p.secretKey.trim());
                  const kindLabel = mcpKindLabel(p.kind);
                  return (
                    <div key={p.id} className="rounded-2xl border border-black/10 bg-white px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-xs font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-lg shrink-0">
                          {kindLabel}
                        </span>
                        <input
                          value={p.name}
                          onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                          name={`mcp-name-${p.id}`}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          className="flex-1 min-w-[8rem] px-2 py-1 bg-transparent border border-transparent hover:border-black/10 focus:border-indigo-300 rounded-lg text-sm font-medium text-[#1d1d1f] focus:outline-none"
                          placeholder="名称"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-[#86868b] shrink-0">
                          <input
                            type="checkbox"
                            checked={p.enabled}
                            onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })}
                          />
                          启用
                        </label>
                        <button
                          type="button"
                          onClick={() => handleTestMcpProvider(p)}
                          disabled={isTesting}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap ${
                            testState?.state === 'ok'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : testState?.state === 'fail'
                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                : 'border-black/10 bg-white text-[#424245] hover:border-indigo-300 hover:text-indigo-700'
                          }`}
                        >
                          {isTesting ? (
                            <span className="animate-spin">⟳</span>
                          ) : testState?.state === 'ok' ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : testState?.state === 'fail' ? (
                            <AlertCircle className="w-3.5 h-3.5" />
                          ) : null}
                          {isTesting ? '验证中…' : testState?.state === 'ok' ? '可用' : testState?.state === 'fail' ? '不可用' : '验证'}
                        </button>
                        {p.kind === 'custom' && (
                          <button
                            type="button"
                            onClick={() => setMcpProviders((prev) => prev.filter((x) => x.id !== p.id))}
                            className="text-xs text-rose-600 hover:underline shrink-0"
                          >
                            删除
                          </button>
                        )}
                      </div>

                      {/* 四样里的「地址 / Key」：**所有数据源一视同仁**，不再按 kind 分支 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[11px] text-[#86868b]">地址</label>
                          <input
                            type="text"
                            value={p.mcpUrl}
                            onChange={(e) => updateProvider(p.id, { mcpUrl: e.target.value })}
                            name={`mcp-endpoint-${p.id}`}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder={mcpUrlPlaceholder(p.kind)}
                            className="w-full px-3 py-2 bg-white border border-black/10 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] text-[#86868b]">Key</label>
                          <input
                            type="password"
                            value={p.secretKey}
                            onChange={(e) => updateProvider(p.id, { secretKey: e.target.value })}
                            name={`mcp-token-${p.id}`}
                            autoComplete="new-password"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder="留空 = 用平台 Key（团队共享）；填了 = 用你自己的（只存在本机）"
                            className="w-full px-3 py-2 bg-white border border-black/10 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </div>

                      {hasOwnKey ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          {/* 掩码显示：只给"前 3 末 4"的指纹，方便确认填的是哪一个 Key */}
                          <span className="text-[11px] text-[#424245] font-mono">已填 · {maskKey(p.secretKey)}</span>
                          <button
                            type="button"
                            onClick={() => updateProvider(p.id, { secretKey: '' })}
                            className="rounded-lg border border-rose-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-700 hover:border-rose-400"
                          >
                            清除本机密钥
                          </button>
                        </div>
                      ) : null}

                      {testState?.note ? (
                        <p className={`text-[11px] ${testState.state === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>
                          {testState.note}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[#86868b]">
                <span>添加数据源：</span>
                {!mcpProviders.some((p) => p.kind === 'sellersprite') && (
                  <button type="button" onClick={() => setMcpProviders((prev) => [...prev, createSellerSpriteProvider()])} className="px-2 py-1 rounded-lg border border-violet-200 text-violet-700 font-medium hover:bg-violet-50">
                    卖家精灵
                  </button>
                )}
                {!mcpProviders.some((p) => p.kind === 'xydc') && (
                  <button type="button" onClick={() => setMcpProviders((prev) => [...prev, createXydcProvider()])} className="px-2 py-1 rounded-lg border border-orange-200 text-orange-700 font-medium hover:bg-orange-50">
                    西柚洞察
                  </button>
                )}
                {!mcpProviders.some((p) => p.kind === 'lingxing') && (
                  <button type="button" onClick={() => setMcpProviders((prev) => [...prev, createLingXingProvider()])} className="px-2 py-1 rounded-lg border border-sky-200 text-sky-700 font-medium hover:bg-sky-50">
                    领星
                  </button>
                )}
                {!mcpProviders.some((p) => p.kind === 'sorftime') && (
                  <button type="button" onClick={() => setMcpProviders((prev) => [...prev, createSorftimeProvider()])} className="px-2 py-1 rounded-lg border border-emerald-200 text-emerald-700 font-medium hover:bg-emerald-50">
                    Sorftime
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMcpProviders((prev) => [...prev, createCustomProvider({ name: `自定义 MCP ${prev.filter((x) => x.kind === 'custom').length + 1}` })])}
                  className="px-2 py-1 rounded-lg border border-black/10 text-[#1d1d1f] font-medium hover:bg-[#f5f5f7]"
                >
                  其他 MCP
                </button>
              </div>
            </div>
          )}

          {tab === 'features' && (
            <div className="space-y-4 overflow-y-auto">
              <p className="text-sm text-[#86868b]">以下功能默认关闭；需要时再打开，避免干扰日常分析。</p>
              <label className="flex items-start gap-3 p-4 rounded-2xl border border-black/10 bg-[#fafafa] cursor-pointer hover:bg-[#f5f5f7]">
                <input
                  type="checkbox"
                  className="mt-1 rounded border-black/20"
                  checked={featureFlags.showMarketScorecard}
                  onChange={(e) => {
                    persistFeatures({ ...featureFlags, showMarketScorecard: e.target.checked });
                    toast.success(e.target.checked ? '已显示「市场准入评估」' : '已隐藏「市场准入评估」');
                  }}
                />
                <div>
                  {/* 2026-09 按用户指示把长说明收进 ⓘ 角标（PRD §15.24）：原文 42 字注脚改为一句 ≤20 字摘要 */}
                  <div className="text-sm font-semibold text-[#1d1d1f] flex items-center gap-1.5">
                    市场准入评估
                    <InfoTip
                      title="市场准入评估是什么"
                      label="查看市场准入评估说明"
                      paragraphs={[
                        '市场大盘顶部的评分卡：体量、增长、集中度、评论数、价格分散度、新品占比、评分、FBA 成本 8 个维度各分绿/黄/红三档，用来快速判断这个市场好不好进。',
                        '它是加分项、不是必选项：关掉不影响任何分析与机会结论，只是不显示这张卡。',
                      ]}
                    />
                  </div>
                  <p className="text-xs text-[#86868b] mt-1 leading-relaxed">默认关闭；打开后市场大盘顶部出现评分卡。</p>
                </div>
              </label>
            </div>
          )}

          {tab === 'prompts' && <AiPromptManager embedded />}
          {tab === 'diagnostics' && <SystemDiagnosticsPanel />}
          {tab === 'admin' && <AdminConsolePanel />}
          {tab === 'team' && <TeamSettingsPanel currentUser={getCurrentUser()} />}
        </div>

        <div className="p-5 sm:p-6 border-t border-black/5 flex justify-end gap-3 shrink-0 bg-white relative z-10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#86868b] hover:text-[#1d1d1f] transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-6 py-2 bg-indigo-600 text-white rounded-full text-sm font-semibold hover:bg-indigo-700 transition-all shadow-md"
          >
            应用设置
          </button>
        </div>
      </div>
    </div>
  );
};
