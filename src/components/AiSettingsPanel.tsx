import React, { useState, useEffect } from 'react';
import { X, Sparkles, Key, Check, AlertCircle, Cpu, FileText, Plus, Globe, CloudDownload, ToggleLeft, UserRound, Shield, ImagePlus, Moon, Sun, Users } from 'lucide-react';
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
  sanitizeAiApiUrls,
} from '../utils/aiConfig';
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
  DEFAULT_SELLERSPRITE_MCP_URL,
  DEFAULT_XYDC_MCP_URL,
  DEFAULT_SORFTIME_MCP_URL,
  type McpProviderEntry,
  type AppFeatureFlags,
} from '../utils/mcpConfig';
import {
  loadUserBackground,
  saveUserBackground,
  EMPTY_USER_BACKGROUND,
  type UserBackgroundProfile,
} from '../utils/userBackground';
import { testMcpProvider } from '../utils/sellerspriteApi';
import { toast } from 'sonner';
import { AiPromptManager } from './AiPromptManager';
import { TeamSettingsPanel } from './TeamSettingsPanel';
import { Select } from './ui/Select';
import { changePassword, updateAccountProfile, type SessionUser } from '../utils/auth';

type SettingsTab = 'account' | 'team' | 'api' | 'profile' | 'mcp' | 'features' | 'prompts';

interface AiSettingsPanelProps {
  settings: AiSettings | null;
  onSave: (settings: AiSettings) => void;
  onClose: () => void;
  /** 功能开关变更时同步到主界面（如市场准入评估显隐） */
  onFeatureFlagsChange?: (flags: AppFeatureFlags) => void;
  currentUser?: SessionUser | null;
  onAccountSaved?: (user: SessionUser) => void;
}

export const AiSettingsPanel: React.FC<AiSettingsPanelProps> = ({
  settings,
  onSave,
  onClose,
  onFeatureFlagsChange,
  currentUser,
  onAccountSaved,
}) => {
  const initialProvider = settings?.provider ?? 'deepseek';
  const initialCfg = getProviderConfig(initialProvider);
  const initialModels = getEffectiveModels(settings ?? { provider: initialProvider, apiKey: '', model: '' }, initialProvider);
  const initialModel = settings?.model && initialModels.includes(settings.model)
    ? settings.model
    : initialCfg.defaultModel;

  const [tab, setTab] = useState<SettingsTab>('account');
  const [provider, setProvider] = useState<AiProvider>(initialProvider);
  const [model, setModel] = useState<string>(initialModel);
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? '');
  const [apiUrls, setApiUrls] = useState<Partial<Record<AiProvider, string>>>(sanitizeAiApiUrls(settings?.apiUrls) ?? {});
  const [customModels, setCustomModels] = useState<Partial<Record<AiProvider, string[]>>>(settings?.customModels ?? {});
  const [newCustomModelName, setNewCustomModelName] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [accountName, setAccountName] = useState(currentUser?.nickname || currentUser?.username || '');
  const [accountAvatar, setAccountAvatar] = useState<string | undefined>(currentUser?.avatarDataUrl);
  const [newPassword, setNewPassword] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    const saved = localStorage.getItem('amzdev_theme');
    return saved === 'dark' || saved === 'system' ? saved : 'light';
  });

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
  const [userBackground, setUserBackground] = useState<UserBackgroundProfile>(() => loadUserBackground(currentUser));

  function loadDisplayMcpProviders(): McpProviderEntry[] {
    return loadMcpSettings().providers.map((p) => ({
      ...p,
      mcpUrl:
        /mcp\.sellersprite\.com/i.test(p.mcpUrl) || /mcp\.xydc\.com/i.test(p.mcpUrl)
          ? ''
          : p.mcpUrl,
    }));
  }

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
    setMcpProviders(loadDisplayMcpProviders());
    setTestResult(null);
  }, [settings]);

  useEffect(() => {
    setAccountName(currentUser?.nickname || currentUser?.username || '');
    setAccountAvatar(currentUser?.avatarDataUrl);
    setUserBackground(loadUserBackground(currentUser));
  }, [currentUser]);

  useEffect(() => {
    localStorage.setItem('amzdev_theme', theme);
    const root = document.documentElement;
    root.dataset.theme = theme;
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && prefersDark));
  }, [theme]);

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

  const handleFetchModels = async () => {
    if (!apiKey.trim()) { toast.error('请先填写 API Key'); return; }
    if (provider === 'custom' && !currentApiUrl.trim()) { toast.error('自定义供应商需要先填写 API 地址'); return; }
    setIsFetchingModels(true);
    try {
      const endpoint = buildEndpoint({ provider, apiKey: apiKey.trim(), model, apiUrls, customModels }, provider);
      const modelsUrl = endpoint.replace(/\/chat\/completions$/i, '/models');
      const res = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { id?: unknown }[]; error?: { message?: string }; message?: string };
      if (!res.ok) throw new Error(body.error?.message || body.message || `HTTP ${res.status}`);
      const fetched: string[] = Array.isArray(body.data)
        ? body.data.map((item) => String(item.id || '').trim()).filter(Boolean)
        : [];
      const next: string[] = [...new Set(fetched)].filter((name) => !cfg.models.includes(name));
      if (next.length === 0) {
        toast.info('没有获取到新的模型，已保留当前模型列表');
        return;
      }
      setCustomModels((prev) => ({ ...prev, [provider]: [...new Set([...(prev[provider] ?? []), ...next])] }));
      setModel((prev) => (prev && [...cfg.models, ...next].includes(prev) ? prev : next[0]));
      toast.success(`已获取 ${next.length} 个模型`);
    } catch (e) {
      toast.error(`获取模型失败：${e instanceof Error ? e.message : '未知错误'}`);
    } finally {
      setIsFetchingModels(false);
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
    saveUserBackground(userBackground, currentUser);
  };

  const persistFeatures = (next: AppFeatureFlags) => {
    setFeatureFlags(next);
    saveFeatureFlags(next);
    onFeatureFlagsChange?.(next);
  };

  const persistAccount = async () => {
    if (!currentUser || currentUser.id === 'guest') return true;
    const profile = updateAccountProfile(currentUser.id, {
      nickname: accountName.trim() || currentUser.username,
      avatarDataUrl: accountAvatar,
    });
    if (!profile.ok) {
      toast.error(profile.error || '账号信息保存失败');
      return false;
    }
    if (newPassword.trim()) {
      const changed = await changePassword(newPassword);
      if (!changed.ok) {
        toast.error(changed.error || '密码修改失败');
        return false;
      }
      setNewPassword('');
    }
    if (profile.user) onAccountSaved?.(profile.user);
    return true;
  };

  const handleAvatarFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error('图片请小于 4MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setAccountAvatar(typeof reader.result === 'string' ? reader.result : undefined);
    reader.onerror = () => toast.error('头像读取失败');
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    persistMcp();
    persistProfile();
    saveFeatureFlags(featureFlags);
    onFeatureFlagsChange?.(featureFlags);

    if (tab === 'account') {
      const ok = await persistAccount();
      if (!ok) return;
      toast.success(newPassword.trim() ? '账号信息和密码已保存' : '账号信息已保存');
      onClose();
      return;
    }

    if (tab === 'mcp' || tab === 'features' || tab === 'profile' || tab === 'team') {
      const msg =
        tab === 'mcp' ? 'MCP 设置已保存' :
        tab === 'team' ? '团队设置已保存' :
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
    { id: 'account', label: '账号', icon: <UserRound className="w-4 h-4" /> },
    { id: 'team', label: '团队', icon: <Users className="w-4 h-4" /> },
    { id: 'api', label: 'API 与模型', icon: <Cpu className="w-4 h-4" /> },
    { id: 'profile', label: '背景信息', icon: <UserRound className="w-4 h-4" /> },
    { id: 'mcp', label: 'MCP 数据', icon: <CloudDownload className="w-4 h-4" /> },
    { id: 'features', label: '功能开关', icon: <ToggleLeft className="w-4 h-4" /> },
    { id: 'prompts', label: 'Prompt', icon: <FileText className="w-4 h-4" /> },
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
          {tab === 'account' && (
            <div className="space-y-5 overflow-y-auto">
              <div className="rounded-2xl border border-black/10 bg-[#fafafa] p-4">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl overflow-hidden bg-indigo-600 flex items-center justify-center text-white text-xl font-bold border border-black/10 shrink-0">
                    {accountAvatar ? (
                      <img src={accountAvatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (accountName || currentUser?.username || '?')[0]?.toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1d1d1f]">账号资料</p>
                    <p className="text-xs text-[#86868b] mt-1 truncate">{currentUser?.email || currentUser?.username || '当前账号'}</p>
                    <label className="mt-3 inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-black/10 bg-white text-sm font-medium text-[#424245] hover:bg-[#f5f5f7] cursor-pointer">
                      <ImagePlus className="w-4 h-4" />
                      更换头像
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => void handleAvatarFile(e.target.files?.[0])} />
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-[#86868b]">昵称</span>
                  <input
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="用于项目负责人和协作展示"
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-[#86868b]">账号</span>
                  <input
                    value={currentUser?.username || ''}
                    disabled
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm text-[#86868b]"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-black/10 bg-white p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-indigo-600" />
                  <p className="text-sm font-bold text-[#1d1d1f]">安全</p>
                </div>
                <label className="space-y-1 block">
                  <span className="text-xs font-semibold text-[#86868b]">新密码</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="留空则不修改，至少 6 位"
                    className="w-full px-3 py-2.5 bg-[#f5f5f7] border border-black/5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-black/10 bg-white p-4 space-y-3">
                <p className="text-sm font-bold text-[#1d1d1f]">外观</p>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ['light', '日间', <Sun className="w-4 h-4" />],
                    ['dark', '夜间', <Moon className="w-4 h-4" />],
                    ['system', '跟随系统', <ToggleLeft className="w-4 h-4" />],
                  ] as const).map(([id, label, icon]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTheme(id)}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm font-semibold ${
                        theme === id
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-[#f5f5f7] text-[#424245] border-black/5 hover:bg-indigo-50'
                      }`}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

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
                <label className="text-sm font-bold text-[#1d1d1f]">
                  模型
                </label>
                <p className="text-xs text-[#86868b]">不同模型在速度、成本与能力上不同，请按供应商文档选择。</p>
                <div className="flex gap-2">
                  <Select
                    value={model}
                    onChange={(v) => { setModel(v); setTestResult(null); }}
                    options={cfg.models.map((m) => ({ value: m, label: m }))}
                    groups={
                      currentCustomModels.length > 0
                        ? [{
                            label: '自定义模型',
                            options: currentCustomModels.map((m) => ({ value: m, label: m })),
                          }]
                        : undefined
                    }
                    size="md"
                    className="flex-1"
                    aria-label="模型"
                  />
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={isFetchingModels}
                    className="px-3 py-2 bg-white border border-black/10 rounded-xl text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:opacity-50 whitespace-nowrap flex items-center gap-1.5"
                  >
                    {isFetchingModels ? <span className="animate-spin">⟳</span> : <CloudDownload className="w-4 h-4" />}
                    获取模型
                  </button>
                </div>

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
                      doubao: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
                      custom: '#',
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

          {tab === 'team' && (
            <TeamSettingsPanel currentUser={currentUser ?? null} />
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
                  toast.info('已清空表单，点「应用设置」后才会真正清除');
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
                可配置多家 MCP：领星、卖家精灵、西柚洞察、Sorftime。管理员会自动预填密钥；业务抓取仍以卖家精灵为主。密钥只保存在本机浏览器。
              </div>

              {mcpProviders.map((p, idx) => {
                const testState = mcpTestResults[p.id];
                const isTesting = testingProviderId === p.id;
                const kindLabel =
                  p.kind === 'sellersprite' ? '卖家精灵'
                  : p.kind === 'xydc' ? '西柚洞察'
                  : p.kind === 'lingxing' ? '领星'
                  : p.kind === 'sorftime' ? 'Sorftime'
                  : '自定义';
                const usesAppProxy = p.kind === 'sellersprite' || p.kind === 'xydc' || p.kind === 'lingxing' || p.kind === 'sorftime';
                return (
                  <div
                    key={p.id}
                    className="rounded-2xl border border-black/10 bg-[#fafafa] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-xs font-semibold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-lg shrink-0">
                          {kindLabel}
                        </span>
                        <input
                          value={p.name}
                          onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                          className="flex-1 min-w-[120px] px-2 py-1.5 bg-white border border-black/5 rounded-lg text-sm font-semibold"
                          placeholder="名称"
                        />
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-[#86868b] shrink-0">
                        <input
                          type="checkbox"
                          checked={p.enabled}
                          onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })}
                        />
                        启用
                      </label>
                      {p.kind === 'custom' && (
                        <button
                          type="button"
                          onClick={() => setMcpProviders((prev) => prev.filter((x) => x.id !== p.id))}
                          className="text-xs text-rose-600 hover:underline"
                        >
                          删除
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[#86868b] flex items-center gap-1">
                        <Key className="w-3.5 h-3.5" />
                        {p.kind === 'xydc' ? 'MCP Token（Bearer）'
                          : p.kind === 'lingxing' ? 'X-Mcp-Key'
                          : p.kind === 'sorftime' ? 'Sorftime Key'
                          : '密钥 / Secret Key'}
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={p.secretKey}
                          onChange={(e) => updateProvider(p.id, { secretKey: e.target.value })}
                          placeholder={
                            p.kind === 'xydc' ? '粘贴西柚 Token…'
                            : p.kind === 'sorftime' ? '粘贴 Sorftime Key…'
                            : '粘贴密钥…'
                          }
                          className="flex-1 px-3 py-2 bg-white border border-black/5 rounded-xl text-sm font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => handleTestMcpProvider(p)}
                          disabled={isTesting}
                          className="px-3 py-2 bg-white border border-black/10 rounded-xl text-sm font-medium hover:bg-[#f5f5f7] disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                        >
                          {isTesting ? (
                            <span className="animate-spin">⟳</span>
                          ) : testState === 'ok' ? (
                            <Check className="w-4 h-4 text-emerald-500" />
                          ) : testState === 'fail' ? (
                            <AlertCircle className="w-4 h-4 text-rose-500" />
                          ) : null}
                          {isTesting ? '验证中…' : '验证'}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[#86868b] flex items-center gap-1">
                        <Globe className="w-3.5 h-3.5" /> MCP 地址
                        {usesAppProxy ? '（建议留空）' : '（必填）'}
                      </label>
                      <input
                        type="text"
                        value={p.mcpUrl}
                        onChange={(e) => updateProvider(p.id, { mcpUrl: e.target.value })}
                        placeholder={
                          usesAppProxy
                            ? '留空 = 走应用内安全代理'
                            : 'https://your-mcp.example.com/mcp'
                        }
                        className="w-full px-3 py-2 bg-white border border-black/5 rounded-xl text-sm font-mono"
                      />
                      {p.kind === 'sellersprite' && (
                        <p className="text-[11px] text-[#86868b] leading-relaxed">
                          不要填 <code className="bg-black/5 px-1 rounded">{DEFAULT_SELLERSPRITE_MCP_URL}</code>
                          ，否则浏览器会跨域报错。只有自建中转时才填自定义地址。
                        </p>
                      )}
                      {p.kind === 'xydc' && (
                        <p className="text-[11px] text-[#86868b] leading-relaxed">
                          不要填 <code className="bg-black/5 px-1 rounded">{DEFAULT_XYDC_MCP_URL}</code>
                          ，官方地址已由应用代理。Token 填上面一栏即可（不用带 Bearer 前缀）。
                        </p>
                      )}
                      {p.kind === 'sorftime' && (
                        <p className="text-[11px] text-[#86868b] leading-relaxed">
                          不要填 <code className="bg-black/5 px-1 rounded">{DEFAULT_SORFTIME_MCP_URL}</code>
                          ，Key 填上面一栏；应用会自动拼到请求参数。
                        </p>
                      )}
                      {p.kind === 'custom' && (
                        <p className="text-[11px] text-[#86868b] leading-relaxed">
                          其他 MCP 需支持浏览器跨域，或填你自己的同源代理路径（如 /api-proxy/xxx）。
                        </p>
                      )}
                      {(p.kind === 'sellersprite' || p.kind === 'xydc' || p.kind === 'lingxing' || p.kind === 'sorftime') &&
                        (/mcp\.sellersprite\.com/i.test(p.mcpUrl) || /mcp\.xydc\.com/i.test(p.mcpUrl) || /openmcp\.lingxing\.com/i.test(p.mcpUrl) || /mcp\.sorftime\.com/i.test(p.mcpUrl)) && (
                        <button
                          type="button"
                          className="text-xs text-amber-800 underline"
                          onClick={() => updateProvider(p.id, { mcpUrl: '' })}
                        >
                          一键清空官方地址（推荐）
                        </button>
                      )}
                    </div>

                    {idx === 0 && p.kind === 'sellersprite' && (
                      <p className="text-[11px] text-violet-700/80">
                        提示：用户洞察、关键词、竞品分析的在线抓取，都会优先用启用中的卖家精灵。
                      </p>
                    )}
                    {p.kind === 'xydc' && (
                      <p className="text-[11px] text-orange-700/80">
                        提示：西柚洞察适合流量结构、广告节奏、关键词打法分析；当前业务抓取仍以卖家精灵为主。
                      </p>
                    )}
                    {p.kind === 'lingxing' && (
                      <p className="text-[11px] text-sky-700/80">
                        提示：领星适合店铺/关键词等 ERP 侧数据；鉴权头为 X-Mcp-Key。
                      </p>
                    )}
                    {p.kind === 'sorftime' && (
                      <p className="text-[11px] text-emerald-700/80">
                        提示：Sorftime 适合 Listing / 品类 / 关键词深度调研；当前应用内抓取仍以卖家精灵为主。
                      </p>
                    )}
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2">
                {!mcpProviders.some((p) => p.kind === 'lingxing') && (
                  <button
                    type="button"
                    onClick={() => setMcpProviders((prev) => [...prev, createLingXingProvider()])}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-sky-200 text-sky-700 text-sm font-medium hover:bg-sky-50"
                  >
                    <Plus className="w-4 h-4" /> 添加领星
                  </button>
                )}
                {!mcpProviders.some((p) => p.kind === 'sellersprite') && (
                  <button
                    type="button"
                    onClick={() => setMcpProviders((prev) => [...prev, createSellerSpriteProvider()])}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-violet-200 text-violet-700 text-sm font-medium hover:bg-violet-50"
                  >
                    <Plus className="w-4 h-4" /> 添加卖家精灵
                  </button>
                )}
                {!mcpProviders.some((p) => p.kind === 'xydc') && (
                  <button
                    type="button"
                    onClick={() => setMcpProviders((prev) => [...prev, createXydcProvider()])}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-orange-200 text-orange-700 text-sm font-medium hover:bg-orange-50"
                  >
                    <Plus className="w-4 h-4" /> 添加西柚洞察
                  </button>
                )}
                {!mcpProviders.some((p) => p.kind === 'sorftime') && (
                  <button
                    type="button"
                    onClick={() => setMcpProviders((prev) => [...prev, createSorftimeProvider()])}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-emerald-200 text-emerald-700 text-sm font-medium hover:bg-emerald-50"
                  >
                    <Plus className="w-4 h-4" /> 添加 Sorftime
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setMcpProviders((prev) => [...prev, createCustomProvider({ name: `自定义 MCP ${prev.filter((x) => x.kind === 'custom').length + 1}` })])}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-black/10 text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7]"
                >
                  <Plus className="w-4 h-4" /> 添加其他 MCP
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
