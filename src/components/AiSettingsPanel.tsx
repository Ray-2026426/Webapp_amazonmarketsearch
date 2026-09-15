import React, { useState, useEffect } from 'react';
import { X, Sparkles, Key, Check, AlertCircle, Cpu, FileText, Plus, Globe, CloudDownload, ToggleLeft, UserRound, ShieldCheck, Users, RefreshCw, Loader2 } from 'lucide-react';
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
import { testMcpProvider } from '../utils/sellerspriteApi';
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

type SettingsTab = 'api' | 'profile' | 'mcp' | 'features' | 'prompts' | 'diagnostics' | 'admin' | 'team';

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
  const [newCustomModelName, setNewCustomModelName] = useState('');
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
      mcpUrl:
        /mcp\.sellersprite\.com/i.test(p.mcpUrl) || /mcp\.xydc\.com/i.test(p.mcpUrl)
          ? ''
          : p.mcpUrl,
    }));
  });
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [mcpTestResults, setMcpTestResults] = useState<Record<string, 'ok' | 'fail'>>({});

  const [featureFlags, setFeatureFlags] = useState<AppFeatureFlags>(() => loadFeatureFlags());
  const [userBackground, setUserBackground] = useState<UserBackgroundProfile>(() => loadUserBackground());

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

  const handleAddCustomModel = () => {
    const name = newCustomModelName.trim();
    if (!name) { toast.error('请输入模型名称'); return; }
    const current = customModels[provider] ?? [];
    if (current.includes(name)) { toast.error('该自定义模型已存在'); return; }
    if (cfg.models.includes(name)) { toast.error('该模型已存在于默认列表中'); return; }
    setCustomModels(prev => ({
      ...prev,
      [provider]: [...(prev[provider] ?? []), name],
    }));
    setNewCustomModelName('');
    toast.success(`已添加自定义模型：${name}`);
  };

  const handleRemoveCustomModel = (name: string) => {
    setCustomModels(prev => ({
      ...prev,
      [provider]: (prev[provider] ?? []).filter(m => m !== name),
    }));
    if (model === name) {
      setModel(cfg.defaultModel);
    }
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

  const handleTestMcpProvider = async (provider: McpProviderEntry) => {
    if (!provider.secretKey.trim()) {
      toast.error('请先填写密钥');
      return;
    }
    if (provider.kind === 'custom' && !provider.mcpUrl.trim()) {
      toast.error('自定义 MCP 需要填写地址');
      return;
    }
    setTestingProviderId(provider.id);
    try {
      await testMcpProvider(provider);
      setMcpTestResults((prev) => ({ ...prev, [provider.id]: 'ok' }));
      toast.success(`「${provider.name}」连接成功`);
    } catch (e: unknown) {
      setMcpTestResults((prev) => ({ ...prev, [provider.id]: 'fail' }));
      toast.error(`验证失败：${e instanceof Error ? e.message : '未知错误'}`);
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
                <label className="text-sm font-bold text-[#1d1d1f]">① 选 AI 供应商</label>
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
                  ② 填 API Key
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

              {/* ③ 获取模型 → 点一个选中 */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-[#1d1d1f]">③ 获取模型，点一个用</label>
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
                  <span className="text-[11px] text-[#86868b]">
                    {!apiKey.trim() ? '先填 Key' : '拉不到就直接手填模型名'}
                  </span>
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

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-[#1d1d1f]">手动添加模型名</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={newCustomModelName}
                        onChange={(e) => setNewCustomModelName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomModel(); }}
                        placeholder="例如 deepseek-flash"
                        className="flex-1 px-3 py-2 bg-white border border-black/10 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomModel}
                        className="px-3 py-2 bg-white border border-black/10 rounded-lg text-xs font-semibold text-[#424245] hover:border-indigo-300 hover:text-indigo-700 transition-colors whitespace-nowrap flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        添加
                      </button>
                    </div>
                    {currentCustomModels.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {currentCustomModels.map((m) => (
                          <span
                            key={m}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-[11px] font-medium"
                          >
                            {m}
                            <button type="button" onClick={() => handleRemoveCustomModel(m)} className="hover:text-rose-600 transition-colors">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </details>
            </div>
          )}

          {tab === 'profile' && (
            <div className="space-y-4 overflow-y-auto">
              <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-sm text-indigo-900 leading-relaxed">
                这里填的是「谁在做判断」：以选择题为主（自由文本只有 3 个），每一组都写明它影响五看里的哪个判断。
                填得越全，「看自己」里要你回答的问题就越少、适配度也越可信；留空不阻塞分析。信息只保存在本机浏览器。
              </div>

              {/* 完整度（确定性；只影响可信度，不影响任何打分权重） */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    bgReport.fraction >= 0.8 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  背景信息完整度 {bgReport.filled}/{bgReport.total}
                </span>
                <span className="text-[11px] text-[#86868b] leading-relaxed">{describeBackgroundCompleteness(bgReport)}</span>
              </div>
              {bgWeak && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-relaxed">
                  建议先补 <b>{bgWeak.title}</b>（还差 {bgWeak.empty} 项）—— 这一组对你当前的判断影响最大。
                </p>
              )}

              {BACKGROUND_GROUPS.map((g) => (
                <div key={g.id} className="rounded-2xl border border-black/8 bg-white p-4 space-y-3">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-[#1d1d1f]">{g.title}</p>
                      <span className="text-[10px] text-[#86868b]">
                        {bgReport.byGroup[g.id].filled}/{bgReport.byGroup[g.id].total} 已填
                      </span>
                    </div>
                    {/* 一句话：这一组影响五看里的哪一个判断 */}
                    <p className="text-[11px] text-indigo-700/80 mt-0.5 leading-relaxed">{g.affects}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {g.fields.map((f) => (
                      <div key={f.key} className={f.kind === 'multi' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
                        <label className="text-xs font-semibold text-[#86868b]">
                          {f.label}
                          {f.hint && <span className="ml-1 font-normal text-[10px] text-[#aeaeb2]">{f.hint}</span>}
                        </label>
                        {f.kind === 'select' ? (
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
                  setUserBackground({ ...EMPTY_USER_BACKGROUND, fields: {}, notes: {}, legacyNotes: '' });
                  toast.info('已清空表单，点「应用设置」后才会真正清除');
                }}
                className="text-xs text-[#86868b] hover:text-rose-600"
              >
                清空背景信息表单
              </button>
            </div>
          )}

          {tab === 'mcp' && (
            <div className="space-y-4 overflow-y-auto">
              {/* 2026-09 用户要求：MCP 配置简化、傻瓜化、没必要出现的文字都删掉。
                  精简原则：① 全局说明只留一句；② 每个数据源压缩成一行（名称 + 启用 + 检查）；
                  ③ 地址这类"默认不用管"的东西收进「高级」；④ 删掉所有营销式提示。 */}
              <p className="text-xs text-[#86868b] leading-relaxed">
                密钥由平台在服务端管理（管理员后台 → 配置中心）。这里只看状态，浏览器不保存任何密钥。
              </p>

              <div className="space-y-2">
                {mcpProviders.map((p) => {
                  const testState = mcpTestResults[p.id];
                  const isTesting = testingProviderId === p.id;
                  const kindLabel =
                    p.kind === 'sellersprite' ? '卖家精灵'
                    : p.kind === 'xydc' ? '西柚洞察'
                    : p.kind === 'lingxing' ? '领星'
                    : p.kind === 'sorftime' ? 'Sorftime'
                    : '自定义';
                  return (
                    <div key={p.id} className="rounded-2xl border border-black/10 bg-white px-4 py-3 space-y-2">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="text-xs font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-lg shrink-0">
                          {kindLabel}
                        </span>
                        <input
                          value={p.name}
                          onChange={(e) => updateProvider(p.id, { name: e.target.value })}
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
                            testState === 'ok'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : testState === 'fail'
                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                : 'border-black/10 bg-white text-[#424245] hover:border-indigo-300 hover:text-indigo-700'
                          }`}
                        >
                          {isTesting ? (
                            <span className="animate-spin">⟳</span>
                          ) : testState === 'ok' ? (
                            <Check className="w-3.5 h-3.5" />
                          ) : testState === 'fail' ? (
                            <AlertCircle className="w-3.5 h-3.5" />
                          ) : null}
                          {isTesting ? '检查中…' : testState === 'ok' ? '可用' : testState === 'fail' ? '不可用' : '检查'}
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

                      {p.secretKey ? (
                        <button
                          type="button"
                          onClick={() => updateProvider(p.id, { secretKey: '' })}
                          className="rounded-lg border border-rose-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-700 hover:border-rose-400"
                        >
                          清除本机残留的旧密钥（{p.secretKey.length} 位）
                        </button>
                      ) : null}

                      <details className="rounded-xl bg-[#f5f5f7] px-3 py-2">
                        <summary className="text-[11px] text-[#424245] cursor-pointer select-none">
                          高级：自定义 MCP 地址（默认留空即可）
                        </summary>
                        <div className="pt-2 space-y-1.5">
                          <input
                            type="text"
                            value={p.mcpUrl}
                            onChange={(e) => updateProvider(p.id, { mcpUrl: e.target.value })}
                            placeholder="留空 = 走应用内安全代理"
                            className="w-full px-3 py-2 bg-white border border-black/10 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <p className="text-[11px] text-[#86868b] leading-relaxed">
                            只有自建中转（或需要走自己的同源代理路径，如 <code className="font-mono">/api-proxy/xxx</code>）时才填；
                            填官方地址会让浏览器跨域报错。
                          </p>
                        </div>
                      </details>
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
                  <div className="text-sm font-semibold text-[#1d1d1f]">市场准入评估</div>
                  <p className="text-xs text-[#86868b] mt-1 leading-relaxed">
                    市场大盘顶部的评分卡（多维度红黄绿灯）。当前版本你暂不满意时，可保持关闭；需要试用时再勾选打开。
                  </p>
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
