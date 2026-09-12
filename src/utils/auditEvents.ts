// M5 · 审计事件（PRD §11.4「审计日志：登录、取数、报告生成、机会决策等关键操作留痕（谁/何时/做了什么）」）。
//
// 目标：把"留痕"做成**结构统一、可查询、可归一化**的数据，而不是各写各的字符串。
// - normalizeAuditEvent：把任意调用点传进来的动作归一化成统一结构（动作白名单 + 目标 + 明细 + 时间）；
// - summarizeAudit：按动作/操作人聚合，给管理员一个概览（谁在什么时候做了什么、失败率）；
// - 敏感值一律不进明细（复用 redactSecrets），避免审计日志自己变成泄露渠道。

import { redactSecrets } from './keyMasking';

/** 动作白名单：新增动作时必须同时更新这里（否则审计会被归一化成 'unknown' 并计入告警） */
export const AUDIT_ACTIONS = [
  'login',
  'logout',
  'fetch', // 取数（数据池调用）
  'report', // 报告生成
  'decision', // 机会决策（Go/No-Go）
  'admin_config', // 配置中心写操作
  'admin_user_ban',
  'admin_user_unban',
  'admin_user_reset',
  'admin_project_delete',
  'export', // 导出审核件
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction | 'unknown', string> = {
  login: '登录',
  logout: '登出',
  fetch: '取数',
  report: '生成报告',
  decision: '机会决策',
  admin_config: '管理员改配置',
  admin_user_ban: '禁用用户',
  admin_user_unban: '启用用户',
  admin_user_reset: '触发重置密码',
  admin_project_delete: '删除项目',
  export: '导出',
  unknown: '未登记动作',
};

export interface AuditEvent {
  id: string;
  actorUserId: string;
  actorEmail?: string;
  action: AuditAction | 'unknown';
  /** 动作对象（项目 id / 用户 id / 配置项 / ASIN） */
  target?: string;
  detail?: Record<string, unknown>;
  createdAt: string;
}

export interface RawAuditEvent {
  id?: string;
  actorUserId?: string;
  actorEmail?: string;
  action?: string;
  target?: string;
  detail?: Record<string, unknown>;
  createdAt?: string;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `a_${Date.now().toString(36)}_${seq}`;
}

/**
 * 归一化一条审计事件。
 * 规则：
 * - action 必须在白名单里，否则记为 'unknown'（**不丢弃**：未知动作也要留痕，方便发现漏登记）；
 * - actorUserId 必填，缺失则记为 'anonymous'（宁可留下匿名记录也不静默丢事件）；
 * - detail 走 redactSecrets，密钥类字段只留指纹。
 */
export function normalizeAuditEvent(raw: RawAuditEvent): AuditEvent {
  const action = String(raw.action ?? '').trim();
  const known = (AUDIT_ACTIONS as readonly string[]).includes(action);
  return {
    id: String(raw.id ?? '').trim() || nextId(),
    actorUserId: String(raw.actorUserId ?? '').trim() || 'anonymous',
    actorEmail: String(raw.actorEmail ?? '').trim() || undefined,
    action: (known ? action : 'unknown') as AuditEvent['action'],
    target: String(raw.target ?? '').trim() || undefined,
    detail: raw.detail ? (redactSecrets(raw.detail) as Record<string, unknown>) : undefined,
    createdAt: String(raw.createdAt ?? '').trim() || new Date().toISOString(),
  };
}

export interface AuditSummaryRow {
  key: string;
  label: string;
  events: number;
  /** 最近一次发生时间 */
  lastAt: string;
}

export interface AuditSummary {
  total: number;
  unknownActions: number;
  byAction: AuditSummaryRow[];
  byActor: AuditSummaryRow[];
  /** 最近事件（时间倒序，最多 limit 条） */
  recent: AuditEvent[];
  summary: string;
}

/** 聚合审计事件（管理员概览；按动作/操作人） */
export function summarizeAudit(events: RawAuditEvent[] | AuditEvent[], opts: { limit?: number } = {}): AuditSummary {
  // 一律归一化（幂等）：不能用"字段名是否存在"来猜是否已归一化——
  // 原始事件同样可能带 actorUserId/action/createdAt，猜错就会把未知动作漏成"已登记"。
  const list = (Array.isArray(events) ? events : []).map((e) => normalizeAuditEvent(e as RawAuditEvent));
  const group = (keyOf: (e: AuditEvent) => string, labelOf: (k: string) => string): AuditSummaryRow[] => {
    const map = new Map<string, AuditEvent[]>();
    for (const e of list) {
      const k = keyOf(e) || 'unknown';
      const arr = map.get(k) ?? [];
      arr.push(e);
      map.set(k, arr);
    }
    return [...map.entries()]
      .map(([k, arr]) => ({
        key: k,
        label: labelOf(k),
        events: arr.length,
        lastAt: arr.map((e) => e.createdAt).sort().reverse()[0] ?? '',
      }))
      .sort((a, b) => b.events - a.events || a.key.localeCompare(b.key));
  };

  const unknownActions = list.filter((e) => e.action === 'unknown').length;
  const byAction = group(
    (e) => e.action,
    (k) => AUDIT_ACTION_LABELS[k as AuditAction] ?? k
  );
  const byActor = group(
    (e) => e.actorEmail || e.actorUserId,
    (k) => k
  );
  const recent = [...list].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, Math.max(1, opts.limit ?? 50));

  return {
    total: list.length,
    unknownActions,
    byAction,
    byActor,
    recent,
    summary:
      list.length === 0
        ? '还没有审计记录'
        : `${list.length} 条审计记录（${byAction.length} 类动作 / ${byActor.length} 个操作人）${
            unknownActions > 0 ? `；其中 ${unknownActions} 条是未登记动作（建议补进 AUDIT_ACTIONS）` : ''
          }`,
  };
}

/** 一行审计事件的人话描述（UI 列表直接用） */
export function describeAuditEvent(e: AuditEvent): string {
  const who = e.actorEmail || e.actorUserId;
  const label = AUDIT_ACTION_LABELS[e.action] ?? e.action;
  return `${new Date(e.createdAt).toLocaleString('zh-CN', { hour12: false })} · ${who} · ${label}${e.target ? ` → ${e.target}` : ''}`;
}
