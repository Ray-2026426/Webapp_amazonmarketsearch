import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

/**
 * M0「设置 → 诊断」面板。
 *
 * 背景：过去登录失败时前端只能提示"登录失败"，无法区分
 * 「密码错 / 配置缺 / 服务不可达 / Supabase 项目被暂停（免费额度闲置 7 天会自动暂停）」。
 * 本面板直接读 `/api/health`，把配置状态与连通性摊开给用户看。
 *
 * 安全：接口只返回"是否配置 + 主机名 + 缺失项"，不含任何密钥值。
 */

interface HealthConfig {
  ready: boolean;
  supabaseUrlConfigured: boolean;
  supabaseHost: string;
  publishableKeyConfigured: boolean;
  serviceRoleKeyConfigured: boolean;
  jwtSecretConfigured: boolean;
  jwtSecretIsInsecureFallback: boolean;
  adminEmailsConfigured: boolean;
  dataPoolKeys: Record<string, boolean>;
  missing: string[];
  warnings: string[];
}

interface HealthProbe {
  attempted: boolean;
  reachable: boolean;
  ms?: number;
  error?: string | null;
  hint?: string | null;
  reason?: string;
}

interface HealthResponse {
  ok: boolean;
  service?: string;
  environment?: string;
  gitRef?: string | null;
  ready?: boolean;
  config?: HealthConfig;
  probe?: HealthProbe;
  error?: string;
}

const DATA_POOL_LABELS: Record<string, string> = {
  sellersprite: '卖家精灵（在线抓数）',
  deepseek: 'AI 默认 Key（DeepSeek 等）',
  lingxing: '领星（可选）',
  xydc: '西柚洞察（可选）',
  sorftime: 'Sorftime（可选）',
};

/** 每项配置缺失时对用户的实际影响 —— 让"缺什么"直接对应"会坏什么" */
const CHECK_ITEMS: {
  key: keyof HealthConfig | 'dataPool';
  label: string;
  envName: string;
  impact: string;
  required: boolean;
}[] = [
  {
    key: 'supabaseUrlConfigured',
    label: '数据库地址',
    envName: 'SUPABASE_URL',
    impact: '缺此项：登录、注册、云同步全部不可用',
    required: true,
  },
  {
    key: 'publishableKeyConfigured',
    label: '公开访问 Key',
    envName: 'SUPABASE_PUBLISHABLE_KEY',
    impact: '缺此项：无法连接数据库，登录必失败',
    required: true,
  },
  {
    key: 'serviceRoleKeyConfigured',
    label: '服务端管理 Key',
    envName: 'SUPABASE_SERVICE_ROLE_KEY',
    impact: '缺此项：注册可能失败（走邮箱确认流程）、管理员接口受限',
    required: false,
  },
  {
    key: 'jwtSecretConfigured',
    label: '登录令牌密钥',
    envName: 'APP_JWT_SECRET',
    impact: '缺此项：使用不安全的开发默认密钥，且换环境后登录态互不认',
    required: false,
  },
  {
    key: 'adminEmailsConfigured',
    label: '管理员邮箱',
    envName: 'ADMIN_EMAILS',
    impact: '缺此项：没有人被识别为管理员，"数据池"配置页打不开',
    required: false,
  },
];

function StatusRow({
  ok,
  label,
  envName,
  impact,
  required,
  detail,
}: {
  ok: boolean;
  label: string;
  envName: string;
  impact: string;
  required: boolean;
  detail?: string;
}) {
  return (
    <div className={`rounded-xl border p-3 ${ok ? 'border-emerald-100 bg-emerald-50/60' : required ? 'border-rose-100 bg-rose-50/60' : 'border-amber-100 bg-amber-50/60'}`}>
      <div className="flex items-start gap-2">
        {ok ? (
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
        ) : required ? (
          <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
        ) : (
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-[#1d1d1f]">{label}</span>
            <code className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 text-[#424245]">{envName}</code>
            {!required && <span className="text-[10px] text-[#86868b]">可选/建议</span>}
          </div>
          {detail && <div className="text-[11px] text-[#424245] mt-1 break-all">{detail}</div>}
          {!ok && <div className="text-[11px] text-[#424245] mt-1">{impact}</div>}
        </div>
      </div>
    </div>
  );
}

export function SystemDiagnosticsPanel() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string>('');

  const load = useCallback(async (probe: boolean) => {
    if (probe) setProbing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/health${probe ? '?probe=1' : ''}`, { headers: { Accept: 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as HealthResponse;
      if (!res.ok) {
        throw new Error(body?.error || `接口返回 HTTP ${res.status}`);
      }
      if (!body?.config) {
        throw new Error('接口返回内容异常（可能部署的是旧版本，尚无 /api/health）');
      }
      setData(body);
      setLastChecked(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (probe) setProbing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const cfg = data?.config;
  const probe = data?.probe;
  const ready = Boolean(cfg?.ready);

  return (
    <div className="space-y-4 overflow-y-auto">
      {/* 总状态 */}
      <div className={`rounded-2xl border p-4 ${ready ? 'border-emerald-100 bg-emerald-50' : 'border-rose-100 bg-rose-50'}`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl bg-white/80 flex items-center justify-center shrink-0 ${ready ? 'text-emerald-600' : 'text-rose-600'}`}>
            {ready ? <ShieldCheck className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-[#1d1d1f]">
                {ready ? '云服务配置就绪' : '云服务未就绪（登录 / 云同步可能不可用）'}
              </span>
              {data?.environment && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 text-[#424245]">环境：{data.environment}</span>
              )}
              {data?.gitRef && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 text-[#424245]">分支：{data.gitRef}</span>
              )}
            </div>
            <p className="text-xs text-[#424245] mt-1">
              {ready
                ? '数据库地址与访问 Key 均已配置，登录与云同步应可正常工作。'
                : '至少缺少数据库地址或公开访问 Key —— 请按下方红框补齐环境变量后重新部署。'}
            </p>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <button
                type="button"
                onClick={() => void load(false)}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-black/10 bg-white text-xs font-semibold text-[#424245] hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                重新检测
              </button>
              <button
                type="button"
                onClick={() => void load(true)}
                disabled={probing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                {probing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                连通性探测
              </button>
              {lastChecked && <span className="text-[11px] text-[#86868b]">检测于 {lastChecked}</span>}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-100 bg-rose-50 p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
          <div className="text-xs text-[#424245]">
            <b className="text-[#1d1d1f]">读取诊断信息失败：</b>
            {error}
            <div className="mt-1 text-[11px] text-[#86868b]">
              若提示接口不存在，说明当前部署还没有本次改动（需先推送并部署 M0 代码）。
            </div>
          </div>
        </div>
      )}

      {/* 配置逐项 */}
      {cfg && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#1d1d1f]">
            <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
            配置逐项检查
          </div>
          {CHECK_ITEMS.map((item) => {
            const ok = Boolean(cfg[item.key as keyof HealthConfig]);
            const detail =
              item.key === 'supabaseUrlConfigured' && cfg.supabaseHost
                ? `当前指向：${cfg.supabaseHost}`
                : item.key === 'jwtSecretConfigured' && ok && cfg.jwtSecretIsInsecureFallback
                  ? '正在使用不安全的开发默认密钥'
                  : undefined;
            return (
              <StatusRow
                key={item.envName}
                ok={ok}
                label={item.label}
                envName={item.envName}
                impact={item.impact}
                required={item.required}
                detail={detail}
              />
            );
          })}
        </div>
      )}

      {/* 数据池密钥 */}
      {cfg && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#1d1d1f]">
            <Cloud className="w-3.5 h-3.5 text-indigo-500" />
            数据池密钥（缺失只影响对应功能）
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(cfg.dataPoolKeys).map(([k, ok]) => (
              <div
                key={k}
                className={`rounded-xl border p-2.5 flex items-center gap-2 ${ok ? 'border-emerald-100 bg-emerald-50/60' : 'border-black/8 bg-[#f8f9fb]'}`}
              >
                {ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#c7c7cc]" />
                )}
                <span className="text-[11px] text-[#424245]">{DATA_POOL_LABELS[k] || k}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 连通性探测结果 */}
      {probe && (
        <div className={`rounded-2xl border p-4 ${probe.reachable ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'}`}>
          <div className="flex items-start gap-3">
            <div className={`w-9 h-9 rounded-xl bg-white/80 flex items-center justify-center shrink-0 ${probe.reachable ? 'text-emerald-600' : 'text-amber-600'}`}>
              <Activity className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-[#1d1d1f]">
                {!probe.attempted
                  ? '未执行探测（配置不完整）'
                  : probe.reachable
                    ? `数据库可达 · 耗时 ${probe.ms ?? '-'} ms`
                    : '数据库不可达'}
              </div>
              {probe.reason && <p className="text-xs text-[#424245] mt-1">{probe.reason}</p>}
              {probe.error && <p className="text-xs text-[#424245] mt-1 break-all">错误：{probe.error}</p>}
              {probe.hint && <p className="text-xs text-[#424245] mt-1">排查建议：{probe.hint}</p>}
              {!probe.reachable && probe.attempted && (
                <div className="mt-2 rounded-lg bg-white/70 border border-black/5 p-2 text-[11px] text-[#424245]">
                  <b className="text-[#1d1d1f]">最常见原因（按概率排序）：</b>
                  <div className="mt-1">① Supabase 免费项目闲置约 7 天被<b>自动暂停</b> → 去控制台点 Resume（数据不丢）</div>
                  <div>② 数据库迁移未执行 → 跑 <code>supabase/migrations/all_in_one.sql</code></div>
                  <div>③ 环境变量指向了别的项目 / Key 不匹配</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 修复指引 */}
      {cfg && (cfg.missing.length > 0 || cfg.warnings.length > 0) && (
        <div className="rounded-xl border border-black/8 bg-[#f8f9fb] p-3">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#1d1d1f] mb-2">
            <Info className="w-3.5 h-3.5 text-indigo-500" />
            怎么修（在 Vercel → Settings → Environment Variables 配置，三个环境都勾选）
          </div>
          {cfg.missing.length > 0 && (
            <ul className="space-y-1">
              {cfg.missing.map((m, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-[#424245]">
                  <XCircle className="w-3 h-3 mt-0.5 shrink-0 text-rose-500" />
                  <span>缺失：{m}</span>
                </li>
              ))}
            </ul>
          )}
          {cfg.warnings.length > 0 && (
            <ul className="space-y-1 mt-2">
              {cfg.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] text-[#424245]">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-[#86868b] mt-2">
            改完环境变量后需要重新部署才会生效。完整步骤见仓库 <code>docs/M0-setup-checklist.md</code>。
          </p>
        </div>
      )}
    </div>
  );
}
