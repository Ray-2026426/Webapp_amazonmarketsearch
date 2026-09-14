-- M5 · 用量记账表（PRD §11.2 用量记账 / §11.4 用量统计）
--
-- 记账口径：workspace × 工具 × 次数；缓存命中仍然记账（cache_hit=true）但成本为 0，
-- 这样既能算钱，也能回答"缓存省了多少次外部调用"。
-- 成本不落库（用 cost_table 在查询时估算），因为单价会变；落库的是可复算的事实（次数/token）。

create table if not exists public.usage_events (
  id                text primary key,
  workspace_id      text not null default 'default',
  user_id           text not null,
  project_id        text,
  tool              text not null,                -- market/keywords/reviews/competitor_listing/traffic/ai/other
  provider          text not null default '',     -- sellersprite/xydc/deepseek/...
  ok                boolean not null default true,
  cache_hit         boolean not null default false,
  calls             integer not null default 0,   -- 外部接口调用次数
  input_tokens      integer,
  output_tokens     integer,
  duration_ms       integer,
  error             text,
  created_at        timestamptz not null default now()
);

-- 管理员按"月/用户/工具/项目"聚合，这条索引覆盖最常见的三种查询
create index if not exists usage_events_created_at_idx on public.usage_events (created_at desc);
create index if not exists usage_events_user_created_idx on public.usage_events (user_id, created_at desc);
create index if not exists usage_events_project_created_idx on public.usage_events (project_id, created_at desc);
create index if not exists usage_events_tool_created_idx on public.usage_events (tool, created_at desc);

-- 仅服务端（service_role）可读写：前端不直连这张表，一律走 /api/admin/*
alter table public.usage_events enable row level security;

drop policy if exists usage_events_service_only on public.usage_events;
create policy usage_events_service_only on public.usage_events
  for all
  using (false)
  with check (false);
-- 说明：service_role 绕过 RLS，因此策略写成"全部拒绝"即可；
-- 普通 JWT 与 anon 一律读不到（这比"允许用户读自己的"更安全，用量只给管理员看）。

-- 审计日志（§11.4 审计日志：登录/取数/报告生成/机会决策等关键操作留痕）
create table if not exists public.audit_events (
  id            text primary key,
  actor_user_id text not null,
  actor_email   text,
  action        text not null,          -- login/fetch/report/decision/admin_config/...
  target        text,                   -- 动作对象（项目 id / 用户 id / 配置项）
  detail        jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_events_created_at_idx on public.audit_events (created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events (actor_user_id, created_at desc);
create index if not exists audit_events_action_idx on public.audit_events (action, created_at desc);

alter table public.audit_events enable row level security;

drop policy if exists audit_events_service_only on public.audit_events;
create policy audit_events_service_only on public.audit_events
  for all
  using (false)
  with check (false);
