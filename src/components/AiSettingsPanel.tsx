import React, { useState, useEffect } from 'react';
import { X, Sparkles, Key, Check, AlertCircle, Cpu, FileText } from 'lucide-react';
import {
  AI_PROVIDERS,
  AiProvider,
  AiSettings,
  getProviderConfig,
  generateText,
} from '../utils/aiConfig';
import { toast } from 'sonner';
import { AiPromptManager } from './AiPromptManager';

type SettingsTab = 'api' | 'prompts';

interface AiSettingsPanelProps {
  settings: AiSettings | null;
  onSave: (settings: AiSettings) => void;
  onClose: () => void;
}

export const AiSettingsPanel: React.FC<AiSettingsPanelProps> = ({
  settings,
  onSave,
  onClose,
}) => {
  const initialProvider = settings?.provider ?? 'gemini';
  const initialCfg = getProviderConfig(initialProvider);
  const initialModel = settings?.model && initialCfg.models.includes(settings.model)
    ? settings.model
    : initialCfg.defaultModel;

  const [tab, setTab] = useState<SettingsTab>('api');
  const [provider, setProvider] = useState<AiProvider>(initialProvider);
  const [model, setModel] = useState<string>(initialModel);
  const [apiKey, setApiKey] = useState(settings?.apiKey ?? '');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  useEffect(() => {
    const p = settings?.provider ?? 'gemini';
    const cfg = getProviderConfig(p);
    const m =
      settings?.model && cfg.models.includes(settings.model)
        ? settings.model
        : cfg.defaultModel;
    setProvider(p);
    setModel(m);
    setApiKey(settings?.apiKey ?? '');
    setTestResult(null);
  }, [settings]);

  const cfg = getProviderConfig(provider);

  const handleProviderChange = (p: AiProvider) => {
    const nextCfg = getProviderConfig(p);
    setProvider(p);
    setModel((prev) => (nextCfg.models.includes(prev) ? prev : nextCfg.defaultModel));
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!apiKey.trim()) { toast.error('请先填写 API Key'); return; }
    setIsTesting(true);
    setTestResult(null);
    try {
      const tmp: AiSettings = { provider, apiKey: apiKey.trim(), model };
      await generateText('你好，请回复"ok"', tmp);
      setTestResult('ok');
      toast.success('API Key 验证成功！');
    } catch (e: any) {
      setTestResult('fail');
      toast.error(`验证失败：${e?.message ?? '未知错误'}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = () => {
    if (!apiKey.trim()) { toast.error('请填写 API Key'); return; }
    onSave({ provider, apiKey: apiKey.trim(), model });
    toast.success('AI 设置已保存');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-3xl rounded-[24px] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-black/5 flex items-center justify-between bg-[#f5f5f7]/50 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-[#1d1d1f]">AI 设置</h3>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors">
            <X className="w-5 h-5 text-[#86868b]" />
          </button>
        </div>

        <div className="px-6 pt-4 shrink-0">
          <div className="flex gap-1 p-1 bg-[#f5f5f7] rounded-xl">
            <button
              type="button"
              onClick={() => setTab('api')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === 'api'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-[#86868b] hover:text-[#1d1d1f]'
              }`}
            >
              <Cpu className="w-4 h-4" />
              API 与模型
            </button>
            <button
              type="button"
              onClick={() => setTab('prompts')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                tab === 'prompts'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-[#86868b] hover:text-[#1d1d1f]'
              }`}
            >
              <FileText className="w-4 h-4" />
              Prompt 管理
            </button>
          </div>
        </div>

        <div className="p-6 flex-1 min-h-0 flex flex-col overflow-hidden">
          {tab === 'api' ? (
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
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
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
          ) : (
            <AiPromptManager embedded />
          )}
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
