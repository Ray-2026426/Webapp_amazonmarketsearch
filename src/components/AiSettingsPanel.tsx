import React, { useState, useEffect } from 'react';
import { X, Sparkles, Key, Check, AlertCircle, Cpu, FileText, Plus, Globe, CloudDownload, ToggleLeft, UserRound } from 'lucide-react';
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
} from '../utils/aiConfig';
import {
  loadMcpSettings,
  saveMcpSettings,
  loadFeatureFlags,
  saveFeatureFlags,
  DEFAULT_SELLERSPRITE_MCP_URL,
  type McpSettings,
  type AppFeatureFlags,
} from '../utils/mcpConfig';
import {
  loadUserBackground,
  saveUserBackground,
  EMPTY_USER_BACKGROUND,
  type UserBackgroundProfile,
} from '../utils/userBackground';
import { testSellerSpriteMcp } from '../utils/sellerspriteApi';
import { toast } from 'sonner';
import { AiPromptManager } from './AiPromptManager';

type SettingsTab = 'api' | 'profile' | 'mcp' | 'features' | 'prompts';

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
  const [apiUrls, setApiUrls] = useState<Partial<Record<AiProvider, string>>>(settings?.apiUrls ?? {});
  const [customModels, setCustomModels] = useState<Partial<Record<AiProvider, string[]>>>(settings?.customModels ?? {});
  const [newCustomModelName, setNewCustomModelName] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  const initialMcp = loadMcpSettings();
  const [mcpSecretKey, setMcpSecretKey] = useState(initialMcp.secretKey);
  const [mcpUrl, setMcpUrl] = useState(initialMcp.mcpUrl);
  const [isMcpTesting, setIsMcpTesting] = useState(false);
  const [mcpTestResult, setMcpTestResult] = useState<'ok' | 'fail' | null>(null);

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
    setApiUrls(settings?.apiUrls ?? {});
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

  const handleTestMcp = async () => {
    if (!mcpSecretKey.trim()) { toast.error('请先填写卖家精灵 Secret Key'); return; }
    setIsMcpTesting(true);
    setMcpTestResult(null);
    try {
      const draft: McpSettings = { secretKey: mcpSecretKey.trim(), mcpUrl: mcpUrl.trim() };
      await testSellerSpriteMcp(draft);
      setMcpTestResult('ok');
      toast.success('MCP 连接验证成功！');
    } catch (e: any) {
      setMcpTestResult('fail');
      toast.error(`MCP 验证失败：${e?.message ?? '未知错误'}`);
    } finally {
      setIsMcpTesting(false);
    }
  };

  const persistMcp = () => {
    saveMcpSettings({ secretKey: mcpSecretKey.trim(), mcpUrl: mcpUrl.trim() });
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
      toast.error('请填写 AI API Key，或切换到「背景信息 / MCP 数据」页单独保存');
      return;
    }
    onSave({
      provider,
      apiKey: apiKey.trim(),
      model,
      apiUrls,
      customModels,
    });
    toast.success('设置已保存');
    onClose();
  };

  const defaultApiUrl = cfg.baseUrl;
  const trimmedApiUrl = currentApiUrl.trim().replace(/\/+$/, '');
  const resolvedApiUrl = trimmedApiUrl ? resolveCustomApiUrl(currentApiUrl, provider) : '';
  const urlWillAutoComplete = Boolean(trimmedApiUrl && resolvedApiUrl !== trimmedApiUrl);
  const urlLooksIncomplete = Boolean(trimmedApiUrl && isBareDomainUrl(currentApiUrl));
  const suggestedApiUrl = trimmedApiUrl ? suggestFullApiUrl(currentApiUrl, provider) : '';

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'api', label: 'API 与模型', icon: <Cpu className="w-4 h-4" /> },
    { id: 'profile', label: '背景信息', icon: <UserRound className="w-4 h-4" /> },
    { id: 'mcp', label: 'MCP 数据', icon: <CloudDownload className="w-4 h-4" /> },
    { id: 'features', label: '功能开关', icon: <ToggleLeft className="w-4 h-4" /> },
    { id: 'prompts', label: 'Prompt', icon: <FileText className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-3xl rounded-[24px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-black/5 flex items-center justify-between bg-[#f5f5f7]/50 shrink-0">
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
            <div className="space-y-6 overflow-y-auto">
              <div className="space-y-3">
                <label className="text-sm font-bold text-[#1d1d1f]">选择 AI 供应商</label>
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

              <div className="space-y-2">
                <label className="text-sm font-bold text-[#1d1d1f]" htmlFor="ai-model-select">
                  模型
                </label>
                <p className="text-xs text-[#86868b]">不同模型在速度、成本与能力上不同，请按供应商文档选择。</p>
                <select
                  id="ai-model-select"
                  value={model}
                  onChange={(e) => { setModel(e.target.value); setTestResult(null); }}
                  className="w-full px-4 py-2.5 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                >
                  {cfg.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  {currentCustomModels.length > 0 && (
                    <optgroup label="── 自定义模型 ──">
                      {currentCustomModels.map((m) => (
                        <option key={`custom-${m}`} value={m}>{m}</option>
                      ))}
                    </optgroup>
                  )}
                </select>

                <div className="mt-2 p-3 bg-[#f5f5f7] rounded-xl border border-black/5">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newCustomModelName}
                      onChange={(e) => setNewCustomModelName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomModel(); }}
                      placeholder="输入自定义模型名称..."
                      className="flex-1 px-3 py-2 bg-white border border-black/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomModel}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors whitespace-nowrap flex items-center gap-1"
                    >
                      <Plus className="w-4 h-4" />
                      添加
                    </button>
                  </div>
                  {currentCustomModels.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {currentCustomModels.map((m) => (
                        <span
                          key={m}
                          className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium"
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

              <div className="space-y-2">
                <label className="text-sm font-bold text-[#1d1d1f] flex items-center gap-2">
                  <Globe className="w-4 h-4 text-indigo-600" />
                  API 请求地址
                </label>
                <p className="text-xs text-[#86868b]">
                  使用中转 API 时必填。留空则使用默认代理地址（
                  <code className="bg-black/5 px-1.5 py-0.5 rounded text-indigo-600">{defaultApiUrl}</code>）。
                </p>
                <input
                  type="text"
                  value={currentApiUrl}
                  onChange={(e) => {
                    setApiUrls(prev => ({ ...prev, [provider]: e.target.value }));
                    setTestResult(null);
                  }}
                  placeholder="https://openrouter.fans/v1"
                  className="w-full px-4 py-2.5 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                />
                {urlWillAutoComplete && !urlLooksIncomplete && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                    <p className="text-xs text-blue-800">
                      实际请求地址：
                      <code className="font-mono text-blue-900 break-all">{resolvedApiUrl}</code>
                    </p>
                  </div>
                )}
                {urlLooksIncomplete && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                    <p className="text-xs text-amber-800">
                      当前地址像是网站首页，请改为完整 API 地址，例如：
                      <br />
                      <code className="font-mono text-amber-900">{suggestedApiUrl}</code>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setApiUrls(prev => ({ ...prev, [provider]: suggestedApiUrl }));
                        setTestResult(null);
                        toast.success('已补全为标准 API 路径');
                      }}
                      className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-semibold hover:bg-amber-700 transition-colors"
                    >
                      一键补全路径
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-[#1d1d1f] flex items-center gap-2">
                  <Key className="w-4 h-4 text-indigo-600" />
                  API Key
                </label>
                <p className="text-xs text-[#86868b]">
                  前往{' '}
                  <a
                    href={{
                      gemini: 'https://aistudio.google.com/apikey',
                      openai: 'https://platform.openai.com/api-keys',
                      claude: 'https://console.anthropic.com/keys',
                      deepseek: 'https://platform.deepseek.com/api_keys',
                      qwen: 'https://dashscope.console.aliyun.com/apiKey',
                      moonshot: 'https://platform.moonshot.cn/console/api-keys',
                      zhipu: 'https://open.bigmodel.cn/usercenter/apikeys',
                    }[provider]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:underline"
                  >
                    {cfg.name} 控制台
                  </a>{' '}
                  获取 API Key，密钥仅存储在您的本地浏览器中。
                </p>
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
              </div>
            </div>
          )}

          {tab === 'profile' && (
            <div className="space-y-4 overflow-y-auto">
              <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-4 py-3 text-sm text-indigo-900 leading-relaxed">
                填写你是谁、做什么品、关心什么。之后用户洞察、关键词、报告等 AI 能力会自动参考这些信息，输出更贴你的业务场景。信息只保存在本机浏览器。
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  ['displayName', '怎么称呼你', '例如：老李 / Ray'],
                  ['role', '岗位角色', '例如：项目经理 / 运营负责人'],
                  ['company', '公司或团队', '例如：XX跨境电商 / OG项目组'],
                  ['brands', '负责品牌', '例如：BrandA、BrandB'],
                  ['categories', '常做品类', '例如：厨房收纳、宠物用品'],
                  ['marketplaces', '主做站点', '例如：US、UK、DE'],
                  ['experience', '经验简述', '例如：亚马逊 5 年，偏开发选品'],
                ] as [keyof UserBackgroundProfile, string, string][]).map(([field, label, ph]) => (
                  <div key={field} className="space-y-1">
                    <label className="text-xs font-semibold text-[#86868b]">{label}</label>
                    <input
                      type="text"
                      value={userBackground[field]}
                      onChange={(e) => setUserBackground((prev) => ({ ...prev, [field]: e.target.value }))}
                      placeholder={ph}
                      className="w-full px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />
                  </div>
                ))}
              </div>
              {([
                ['goals', '近期目标', '例如：本季度找到 2 个可测款；老品改版提升转化'],
                ['constraints', '约束条件', '例如：MOQ 要低、优先现有供应链、广告预算有限'],
                ['analysisStyle', '希望 AI 怎么说', '例如：结论先行、少套话、给可执行动作清单'],
                ['extraNotes', '其他补充', '任何希望 AI 记住的业务偏好或禁区'],
              ] as [keyof UserBackgroundProfile, string, string][]).map(([field, label, ph]) => (
                <div key={field} className="space-y-1">
                  <label className="text-xs font-semibold text-[#86868b]">{label}</label>
                  <textarea
                    value={userBackground[field]}
                    onChange={(e) => setUserBackground((prev) => ({ ...prev, [field]: e.target.value }))}
                    placeholder={ph}
                    rows={2}
                    className="w-full px-3 py-2 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-y min-h-[64px]"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  setUserBackground({ ...EMPTY_USER_BACKGROUND });
                  toast.info('已清空表单，点「保存设置」后才会真正清除');
                }}
                className="text-xs text-[#86868b] hover:text-rose-600"
              >
                清空背景信息表单
              </button>
            </div>
          )}

          {tab === 'mcp' && (
            <div className="space-y-5 overflow-y-auto">
              <div className="rounded-2xl bg-violet-50 border border-violet-100 px-4 py-3 text-sm text-violet-900 leading-relaxed">
                在这里填写卖家精灵 MCP 密钥后，用户洞察 / 关键词页就能「在线抓取」评论和流量词，不用再手动下载 Excel。
                密钥只保存在你这台电脑的浏览器里。
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-[#1d1d1f] flex items-center gap-2">
                  <Key className="w-4 h-4 text-violet-600" />
                  卖家精灵 Secret Key
                </label>
                <p className="text-xs text-[#86868b]">
                  与 Cursor 里 <code className="bg-black/5 px-1 rounded">sellersprite-mcp</code> 配置的
                  <code className="bg-black/5 px-1 rounded mx-1">secret-key</code>
                  相同。可在卖家精灵开放平台 / MCP 控制台获取。
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={mcpSecretKey}
                    onChange={(e) => { setMcpSecretKey(e.target.value); setMcpTestResult(null); }}
                    placeholder="粘贴 secret-key…"
                    className="flex-1 px-4 py-2.5 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleTestMcp}
                    disabled={isMcpTesting}
                    className="px-4 py-2.5 bg-white border border-black/10 rounded-xl text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors disabled:opacity-50 whitespace-nowrap flex items-center gap-2"
                  >
                    {isMcpTesting ? (
                      <span className="animate-spin">⟳</span>
                    ) : mcpTestResult === 'ok' ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : mcpTestResult === 'fail' ? (
                      <AlertCircle className="w-4 h-4 text-rose-500" />
                    ) : null}
                    {isMcpTesting ? '验证中...' : '验证'}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-[#1d1d1f] flex items-center gap-2">
                  <Globe className="w-4 h-4 text-violet-600" />
                  MCP 地址（可选）
                </label>
                <p className="text-xs text-[#86868b]">
                  一般<strong>留空</strong>即可，系统会走本应用安全代理（推荐）。仅当你有自建中转时才填写完整地址。
                  官方默认：<code className="bg-black/5 px-1 rounded">{DEFAULT_SELLERSPRITE_MCP_URL}</code>
                </p>
                <input
                  type="text"
                  value={mcpUrl}
                  onChange={(e) => { setMcpUrl(e.target.value); setMcpTestResult(null); }}
                  placeholder="留空 = 使用应用内置代理"
                  className="w-full px-4 py-2.5 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 font-mono"
                />
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
        </div>

        <div className="p-6 border-t border-black/5 flex justify-end gap-3 shrink-0">
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
            保存设置
          </button>
        </div>
      </div>
    </div>
  );
};
