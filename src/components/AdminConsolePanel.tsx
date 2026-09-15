import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Loader2, RefreshCw, ScrollText, Users } from 'lucide-react';
import { cn } from './ui/Card';
import { Card } from './ui/Card';
import { getAuthToken, isAdminSession, getCurrentUser } from '../utils/auth';
import { describeUsage, summarizeUsage, type UsageSummary } from '../utils/usageAccounting';
import { clearPerfSamples, loadPerfSamples, summarizePerf } from '../utils/perfBudget';

/**
 * M5 · 管理员后台面板（PRD §11.4）。
 *
 * 仅管理员可见（非管理员直接给一句说明，不渲染任何数据）。
 * 六个模块与 §11.4 表格一一对应：用户管理 / 用量统计 / 配置中心 / 审计日志 / 项目与报告 / 环境自检。
 *
 * 安全口径：
 * - 面板只传 token，不传任何密钥；
 * - 配置中心只显示"是否已配置 + 指纹"，**不回显密钥值**；
 * - 重置密码这类敏感动作只提示"已触发"，不回传重置链接（链接等于临时凭证）。
 */

type AdminTab = 'health' | 'usage' | 'users' | 'config' | 'audit' | 'projects';

interface HealthPayload {
  ok?: boolean;
  error?: string;
  checkedAt?: string;
  supabase?: { configured: boolean; reachable: boolean; error?: string };
  /** 数据库表自检（回答"要不要跑迁移"）：逐表探测 + 缺失清单 + 该怎么补 */
  database?: {
    client: 'service_role' | 'none';
    tables: { name: string; ok: boolean; migration: string; required: boolean; why: string; error?: string }[];
    missingRequired: string[];
    hint: string;
  } | null;
  env?: Record<string, { configured: boolean; fingerprint?: string; count?: number }>;
  providers?: Record<string, { configured: boolean; fingerprint?: string }>;
  note?: string;
  cloudDisabled?: boolean;
}

interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  role: string;
  createdAt: string;
  lastSignInAt: string;
  banned: boolean;
}

const TABS: { id: AdminTab; label: string }[] = [
  { id: 'health', label: '环境自检' },
  { id: 'usage', label: '用量统计' },
  { id: 'users', label: '用户管理' },
  { id: 'config', label: '配置中心' },
  { id: 'audit', label: '审计日志' },
  { id: 'projects', label: '项目与报告' },
];

/**
 * 缺表提示（模块级暂存 + 取走即清）：服务端把"缺表"与"真错误"分开了 ——
 * 缺表返回 200 + needsMigration + 指引，这里把它交给界面展示成一条**友好提示**而不是报错。
 */
export interface MigrationNotice {
  hint: string;
  missingTable: string;
  where: string;
}
let pendingMigrationNotice: MigrationNotice | null = null;
export function takeMigrationNotice(): MigrationNotice | null {
  const n = pendingMigrationNotice;
  pendingMigrationNotice = null;
  return n;
}

/**
 * 调管理员接口。
 *
 * 2026-09 修：以前只显示 `HTTP 500` —— 用户拿着这句话没法定位。
 * 现在把**原始响应**留着：非 JSON（例如 Vercel 的函数崩溃页 FUNCTION_INVOCATION_FAILED）、
 * 空响应、5xx 都会把前 300 字原样带出来，并提示去哪里看日志。
 */
async function adminCall<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`/api/admin/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...body }),
  });

  const raw = await res.text();
  let payload: (T & { ok?: boolean; error?: string }) | null = null;
  try {
    payload = JSON.parse(raw) as T & { ok?: boolean; error?: string };
  } catch {
    payload = null;
  }

  if (!res.ok || payload?.ok === false) {
    if (payload?.error) throw new Error(payload.error);
    const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new Error(
      `HTTP ${res.status}（${action}）` +
        (snippet ? `：${snippet}` : '：响应为空') +
        '｜排查：这次请求是服务端函数抛错，去 Vercel → Deployments → 最新那次 → Functions 日志看堆栈'
    );
  }
  if (!payload) {
    throw new Error(`HTTP ${res.status}（${action}）：响应不是 JSON，无法解析`);
  }

  const maybe = payload as unknown as { needsMigration?: boolean; hint?: string; missingTable?: string; where?: string };
  pendingMigrationNotice = maybe.needsMigration
    ? { hint: maybe.hint ?? '', missingTable: maybe.missingTable ?? '', where: maybe.where ?? action }
    : null;

  return payload;
}

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—');

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
        ok ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
      )}
    >
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      {label}
    </span>
  );
}

export function AdminConsolePanel() {
  const user = getCurrentUser();
  const isAdmin = isAdminSession(user);
  const [tab, setTab] = useState<AdminTab>('health');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** 缺表时的友好提示（不是错误，是"该跑迁移了"）：hint + 缺哪张表 */
  const [migrationNotice, setMigrationNotice] = useState<{ hint: string; missingTable: string; where: string } | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [usage, setUsage] = useState<{ summary: UsageSummary; describe: string; cloudDisabled?: boolean } | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [auditEvents, setAuditEvents] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [configKeys, setConfigKeys] = useState<Record<string, { configured: boolean; fingerprint: string }>>({});
  const [keyDraft, setKeyDraft] = useState<{ name: string; value: string }>({ name: 'sellersprite', value: '' });
  // M5 性能基线：本地打点（项目中心加载等）的判定结果
  const [perf, setPerf] = useState(() => summarizePerf(loadPerfSamples()));

  const load = useCallback(
    async (which: AdminTab) => {
      setBusy(true);
      setError('');
      try {
        if (which === 'health') setHealth(await adminCall<HealthPayload>('health'));
        else if (which === 'usage') setUsage(await adminCall<{ summary: UsageSummary; describe: string; cloudDisabled?: boolean }>('usage'));
        else if (which === 'users') setUsers((await adminCall<{ users: AdminUserRow[] }>('users', { op: 'list' })).users ?? []);
        else if (which === 'config') setConfigKeys((await adminCall<{ keys: Record<string, { configured: boolean; fingerprint: string }> }>('config', { op: 'get' })).keys ?? {});
        else if (which === 'audit') setAuditEvents((await adminCall<{ events: Record<string, unknown>[] }>('audit', { limit: 100 })).events ?? []);
        else if (which === 'projects') setProjects((await adminCall<{ projects: Record<string, unknown>[] }>('projects', { op: 'list' })).projects ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        // 缺表提示与错误分开显示：缺表时不是"坏了"，是"该跑迁移了"
        setMigrationNotice(takeMigrationNotice());
        setBusy(false);
      }
    },
    []
  );

  useEffect(() => {
    if (isAdmin) void load(tab);
  }, [tab, isAdmin, load]);

  if (!isAdmin) {
    return (
      <Card>
        <div className="p-5">
          <p className="text-sm font-semibold text-[#1d1d1f]">管理员后台</p>
          <p className="text-xs text-[#86868b] mt-1 leading-relaxed">
            当前账号不是管理员，无法访问用户/用量/配置/审计等数据。如需权限，请联系管理员把你加入 ADMIN_EMAILS。
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors',
                tab === t.id ? 'bg-indigo-600 text-white' : 'border border-black/10 bg-white text-[#86868b] hover:border-indigo-300 hover:text-indigo-700'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load(tab)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-xl border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-[#86868b] hover:text-indigo-600 disabled:opacity-60"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 刷新
        </button>
      </div>

      {/* 缺表 = 该跑迁移了（不是错误，所以用琥珀色提示而不是红色报错） */}
      {migrationNotice && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-900 space-y-1">
          <p className="font-semibold">数据库还没迁移（不是故障，跑一次就好）</p>
          {migrationNotice.missingTable && (
            <p>
              缺的表：<code className="font-mono">{migrationNotice.missingTable}</code>
            </p>
          )}
          <p>{migrationNotice.hint}</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
          {error}
          {error.includes('云端未配置') || error.includes('cloudDisabled') ? '' : '（本地无 service_role 时，用户/项目/审计需要云端；环境自检与数据池状态仍可用）'}
        </div>
      )}

      {/* ① 环境自检 */}
      {tab === 'health' && health && (        <Card>
          <div className="p-4 space-y-2">
            <p className="text-sm font-semibold text-[#1d1d1f]">环境自检（{fmtTime(health.checkedAt)}）</p>
            <p className="text-[11px] text-[#86868b]">{health.note || '只返回"是否已配置 + 指纹"，不回显密钥值'}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div className="rounded-xl border border-black/8 bg-[#f8f9fb] px-3 py-2">
                <p className="text-[11px] font-semibold text-[#424245]">Supabase</p>
                <div className="mt-1 space-y-1">
                  <StatusPill ok={Boolean(health.supabase?.configured)} label={`service_role ${health.supabase?.configured ? '已配置' : '未配置'}`} />
                  <StatusPill ok={Boolean(health.supabase?.reachable)} label={health.supabase?.reachable ? '连通' : '不可达'} />
                  {health.supabase?.error && <p className="text-[10px] text-rose-600">{health.supabase.error}</p>}
                </div>
              </div>
              <div className="rounded-xl border border-black/8 bg-[#f8f9fb] px-3 py-2">
                <p className="text-[11px] font-semibold text-[#424245]">服务端环境</p>
                <div className="mt-1 space-y-1">
                  {Object.entries(health.env ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <StatusPill ok={v.configured} label={k} />
                      <span className="text-[10px] text-[#86868b]">
                        {v.configured ? v.fingerprint || `已配置${typeof v.count === 'number' ? `（${v.count} 个）` : ''}` : '未配置'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-black/8 bg-white px-3 py-2">
              <p className="text-[11px] font-semibold text-[#424245]">数据库表（要不要跑迁移，看这里）</p>
              <p className="text-[11px] text-[#86868b] mt-0.5">{health.database?.hint || '未取到表状态'}</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {(health.database?.tables ?? []).map((t) => (
                  <StatusPill
                    key={t.name}
                    ok={t.ok}
                    label={`${t.name} ${t.ok ? '已建' : t.required ? '缺失（必建）' : '缺失（可选）'} · 迁移 ${t.migration}`}
                  />
                ))}
              </div>
              {health.database?.tables?.some((t) => !t.ok) && (
                <p className="text-[10px] text-[#86868b] mt-1.5">
                  补迁移：Supabase → SQL Editor → 执行仓库里的 <code className="font-mono">supabase/migrations/all_in_one.sql</code>（可重复执行）。
                </p>
              )}
            </div>

            <div className="rounded-xl border border-black/8 bg-white px-3 py-2">
              <p className="text-[11px] font-semibold text-[#424245]">数据池 provider（服务端密钥）</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {Object.entries(health.providers ?? {}).map(([k, v]) => (
                  <StatusPill key={k} ok={v.configured} label={`${k} ${v.configured ? v.fingerprint : '未配置'}`} />
                ))}
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await adminCall<{ usage?: string; cache?: { entries: number } }>('usage', {});
                    alert(typeof r.usage === 'string' ? r.usage : '数据池用量见"用量统计"页');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '查询失败');
                  }
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-black/10 bg-white px-2.5 py-1 text-[10px] font-semibold text-[#86868b] hover:text-indigo-700"
              >
                <BarChart3 className="w-3 h-3" /> 查看数据池状态
              </button>
            </div>

            {/* M5 性能基线：把 ≤2s 这类验收线变成可读数字（本地打点，中位数口径） */}
            <div className="rounded-xl border border-black/8 bg-white px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-[#424245]">性能基线（本地实测）</p>
                <button
                  type="button"
                  onClick={() => {
                    clearPerfSamples();
                    setPerf(summarizePerf([]));
                  }}
                  className="rounded-lg border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#86868b] hover:border-indigo-300 hover:text-indigo-700"
                >
                  清空打点
                </button>
              </div>
              <p className="mt-1 text-[11px] text-[#424245]">{perf.summary}</p>
              {perf.verdicts.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {perf.verdicts.map((v) => (
                    <li key={v.key} className="flex items-center gap-2">
                      <StatusPill ok={v.ok} label={v.label} />
                      <span className="text-[10px] text-[#86868b]">
                        {v.durationMs}ms / 预算 {v.budgetMs}ms（中位数）
                        {!v.ok && ` — 超 ${Math.round(v.overBy * 100)}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-[#86868b]">
                打点位置：项目中心加载（PRD §12 M5「≤2s」）。跑几次项目中心后回到本页刷新，即可看到实测数字。
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ② 用量统计 */}
      {tab === 'usage' && usage && (
        <Card>
          <div className="p-4 space-y-2">
            <p className="text-sm font-semibold text-[#1d1d1f]">用量统计</p>
            <p className="text-[11px] text-[#86868b]">{usage.describe || describeUsage(usage.summary)}</p>
            {usage.cloudDisabled && (
              <p className="text-[10px] text-amber-700">云端未配置：当前展示的是数据池进程内统计（重启后归零）；配置 service_role 后会落到 usage_events 表。</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-black/8 text-[#86868b]">
                    <th className="py-1 pr-3">维度</th>
                    <th className="py-1 pr-3">事件</th>
                    <th className="py-1 pr-3">外部调用</th>
                    <th className="py-1 pr-3">缓存命中</th>
                    <th className="py-1 pr-3">失败率</th>
                    <th className="py-1 pr-3">估算成本</th>
                    <th className="py-1">缓存省下</th>
                  </tr>
                </thead>
                <tbody>
                  {[usage.summary.total, ...usage.summary.byTool].map((r) => (
                    <tr key={r.key} className="border-b border-black/5">
                      <td className="py-1 pr-3">{r.key === 'total' ? '合计' : r.label}</td>
                      <td className="py-1 pr-3 tabular-nums">{r.events}</td>
                      <td className="py-1 pr-3 tabular-nums">{r.calls}</td>
                      <td className="py-1 pr-3 tabular-nums">{r.cacheHits}</td>
                      <td className="py-1 pr-3 tabular-nums">{(r.failureRate * 100).toFixed(1)}%</td>
                      <td className="py-1 pr-3 tabular-nums">${r.costUsd.toFixed(4)}</td>
                      <td className="py-1 tabular-nums">${r.savedUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-[#86868b]">
              按用户：{usage.summary.byUser.map((u) => `${u.key}(${u.events})`).join('、') || '无'}；按项目：
              {usage.summary.byProject.map((p) => `${p.key}(${p.events})`).join('、') || '无'}
            </p>
          </div>
        </Card>
      )}

      {/* ③ 用户管理 */}
      {tab === 'users' && (
        <Card>
          <div className="p-4 space-y-2">
            <p className="text-sm font-semibold text-[#1d1d1f]">用户管理（{users.length}）</p>
            {users.length === 0 ? (
              <p className="text-[11px] text-[#86868b]">没有数据（本地无 service_role 时无法列出云端用户）。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-black/8 text-[#86868b]">
                      <th className="py-1 pr-3">账号</th>
                      <th className="py-1 pr-3">角色</th>
                      <th className="py-1 pr-3">最近登录</th>
                      <th className="py-1 pr-3">状态</th>
                      <th className="py-1">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className="border-b border-black/5">
                        <td className="py-1 pr-3">
                          {u.email || u.username || u.id.slice(0, 8)}
                        </td>
                        <td className="py-1 pr-3">{u.role}</td>
                        <td className="py-1 pr-3">{fmtTime(u.lastSignInAt)}</td>
                        <td className="py-1 pr-3">
                          <StatusPill ok={!u.banned} label={u.banned ? '已禁用' : '正常'} />
                        </td>
                        <td className="py-1">
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await adminCall('users', { op: u.banned ? 'unban' : 'ban', userId: u.id });
                                  await load('users');
                                } catch (e) {
                                  setError(e instanceof Error ? e.message : '操作失败');
                                }
                              }}
                              className="rounded-lg border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#86868b] hover:border-indigo-300 hover:text-indigo-700"
                            >
                              {u.banned ? '启用' : '禁用'}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await adminCall('users', { op: 'reset_password', email: u.email });
                                  alert('已触发找回密码流程（出于安全考虑不回传重置链接）');
                                } catch (e) {
                                  setError(e instanceof Error ? e.message : '操作失败');
                                }
                              }}
                              className="rounded-lg border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#86868b] hover:border-indigo-300 hover:text-indigo-700"
                            >
                              重置密码
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ④ 配置中心 */}
      {tab === 'config' && (
        <Card>
          <div className="p-4 space-y-2">
            <p className="text-sm font-semibold text-[#1d1d1f]">配置中心</p>
            <p className="text-[11px] text-[#86868b] leading-relaxed">
              密钥**只在服务端**保存与使用；这里只显示"是否已配置 + 指纹"，输入框永远不回显已有值。
              保存后由数据池在服务端调用（前端永不接触密钥）。
            </p>
            <div className="space-y-1.5">
              {Object.entries(configKeys).map(([k, v]) => (
                <div key={k} className="flex flex-wrap items-center gap-2 rounded-xl border border-black/8 bg-[#f8f9fb] px-3 py-2">
                  <span className="text-[11px] font-semibold text-[#1d1d1f]">{k}</span>
                  <StatusPill ok={v.configured} label={v.configured ? `已配置（${v.fingerprint}）` : '未配置'} />
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const input = window.prompt(`输入新的 ${k}（留空取消；值只在服务端保存）`);
                        if (!input) return;
                        await adminCall('config', { op: 'set', key: k, value: input });
                        await load('config');
                        alert('已保存（服务端），前端不会保存该值');
                      } catch (e) {
                        setError(e instanceof Error ? e.message : '保存失败');
                      }
                    }}
                    className="ml-auto rounded-lg border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#86868b] hover:border-indigo-300 hover:text-indigo-700"
                  >
                    更新
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`确定清空 ${k}？清空后相关数据池调用会失败。`)) return;
                      try {
                        await adminCall('config', { op: 'clear', key: k });
                        await load('config');
                      } catch (e) {
                        setError(e instanceof Error ? e.message : '清空失败');
                      }
                    }}
                    className="rounded-lg border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#86868b] hover:border-rose-300 hover:text-rose-700"
                  >
                    清空
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[#86868b]">
              提示：本地开发可直接在 .env.local 设置 SELLERSPRITE_SECRET_KEY 等环境变量（dev server 只注入服务端进程，不暴露给浏览器）。
            </p>
          </div>
        </Card>
      )}

      {/* ⑤ 审计日志 */}
      {tab === 'audit' && (
        <Card>
          <div className="p-4 space-y-2">
            <p className="text-sm font-semibold text-[#1d1d1f] flex items-center gap-1.5">
              <ScrollText className="w-4 h-4 text-indigo-600" /> 审计日志（最近 {auditEvents.length} 条）
            </p>
            {auditEvents.length === 0 ? (
              <p className="text-[11px] text-[#86868b]">没有记录（本地无 service_role 时审计不落库）。</p>
            ) : (
              <ul className="space-y-1">
                {auditEvents.map((e, i) => (
                  <li key={i} className="text-[10px] text-[#424245] leading-relaxed">
                    {fmtTime(String(e.created_at || ''))} · {String(e.actor_email || e.actor_user_id || '')} · {String(e.action || '')}
                    {e.target ? ` → ${String(e.target)}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {/* ⑥ 项目与报告 */}
      {tab === 'projects' && (
        <Card>
          <div className="p-4 space-y-2">
            <p className="text-sm font-semibold text-[#1d1d1f] flex items-center gap-1.5">
              <Users className="w-4 h-4 text-indigo-600" /> 项目与报告（{projects.length}）
            </p>
            {projects.length === 0 ? (
              <p className="text-[11px] text-[#86868b]">没有数据（本地无 service_role 时读不到云端项目）。</p>
            ) : (
              <ul className="space-y-1">
                {projects.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 text-[11px]">
                    <span className="text-[#1d1d1f]">{String(p.name || p.id)}</span>
                    <span className="text-[#86868b]">{String(p.status || '')}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(`删除项目「${String(p.name || p.id)}」？该操作会写审计日志。`)) return;
                        try {
                          await adminCall('projects', { op: 'delete', projectId: String(p.id) });
                          await load('projects');
                        } catch (e) {
                          setError(e instanceof Error ? e.message : '删除失败');
                        }
                      }}
                      className="ml-auto rounded-lg border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#86868b] hover:border-rose-300 hover:text-rose-700"
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
