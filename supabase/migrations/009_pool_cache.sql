-- M5 · 数据池持久化缓存表（PRD §11.2「请求缓存（词/ASIN/评论按 TTL 缓存，降本）」）
--
-- 为什么必须落库：网关（api/data/[action].ts）原先只有"进程内 Map"这一层缓存，而 Serverless 实例随时会被回收，
-- 冷启动后缓存全部丢失 → 同一个 ASIN / 同一批关键词被反复向外部 MCP 付费取数，且"到底省了多少次调用"无从度量。
-- 这张表让缓存跨请求、跨实例、跨部署存活；hits 落库后，命中率与降本效果可以在管理后台按类型统计。
--
-- 口径要点：
-- - key 由 buildCacheKey() 生成（v1 前缀 + 参数归一化），因此天然去重，且口径变化时可整体失效；
-- - value 存 jsonb 原始响应；只写**成功**结果（失败不缓存，避免把错误缓存起来挡住重试）；
-- - expires_at 由 TTL 分档（DEFAULT_TTL_SECONDS）算出，过期判断与内存缓存共用 isFresh() 同一套规则；
-- - 过期清理由网关按 expires_at <= now 删除（见 src/utils/poolCacheStore.ts 的 prunePlan），
--   不引入数据库定时任务，少一个运维件。

create table if not exists public.pool_cache (
  key         text primary key,                 -- buildCacheKey() 生成的缓存键（v1:<type>:<归一化参数>）
  type        text not null,                    -- keywords/asin_detail/reviews/listing/traffic/market/other
  value       jsonb not null,                   -- 外部响应原文（jsonb 便于查询与压缩）
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,             -- 过期时间；<= now 即可清理
  hits        integer not null default 0        -- 命中次数（每次命中 +1，用于算"省了多少次外部调用"）
);

-- 清理任务只按过期时间扫描，单独建索引避免全表扫
create index if not exists pool_cache_expires_at_idx on public.pool_cache (expires_at);
-- 管理后台/排查时按类型统计与抽样
create index if not exists pool_cache_type_idx on public.pool_cache (type);

-- 仅服务端（service_role）可读写：前端不直连这张表，一律走 /api/data/*（缓存内容付费取回，等效于数据池额度）
alter table public.pool_cache enable row level security;

drop policy if exists pool_cache_service_only on public.pool_cache;
create policy pool_cache_service_only on public.pool_cache
  for all
  using (false)
  with check (false);
-- 说明：service_role 绕过 RLS，因此策略写成"全部拒绝"即可；
-- 普通 JWT 与 anon 一律读写不到：缓存里存的是按 key 付费取回的外部数据，泄露等于泄露数据池成本。
