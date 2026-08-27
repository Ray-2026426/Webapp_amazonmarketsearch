# Phase 3 云同步验证状态

更新时间：2026-08-26

## 已完成

- Supabase Publishable Key 应用内配置与格式校验。
- 支持 Supabase 邮箱云账号注册、登录、退出和当前云身份显示。
- 支持后端托管云账号：`/api/cloud/session` 从部署环境变量读取 Supabase URL、Publishable Key、云账号邮箱和密码，前端只接收 session，不展示云端账号密码。
- 匿名会话仍作为兼容回退；登录云账号后可进入跨设备恢复验收。
- `project_members` 成员表与 owner/editor/viewer RLS 迁移已补充，并对旧 `projects.user_id` 数据回填 owner。
- 客户端同步写入 `owner_id` 与 owner 成员关系；未应用新迁移的旧 Supabase 项目会回退到 001 个人同步写入。
- 已补充 owner 首次 upsert bootstrap 策略，避免新项目首写时因成员关系尚未建立而被 update policy 拦截。
- 已在真实 Supabase 项目完成邮箱账号冒烟验收：登录、项目写入、owner 成员关系写入、读回、owner 更新、owner 删除清理均通过；匿名未登录读清理后项目返回 0 条。
- 按 RLS 隔离当前云用户可访问的项目，权限模型已从「仅自己」扩展到「成员可读、owner/editor 可写、owner 可删」。
- 云端项目拉取后持久化回本地 IndexedDB。
- 云同步已从项目列表扩展为项目整包：看市场、看用户、看竞品、看自己、机会卡和报告资产会随 `projects.data.cloudData` 一起上云；云端拉回后会恢复到本地缓存。
- 项目中心加载后会自动尝试一次云同步，手动同步也会同步完整项目内容。
- 新建、复制、归档/恢复、删除项目后会后台同步。
- 项目工作区内五看保存或编辑项目造成项目版本变化后，会后台防抖自动同步整包项目内容；报告定稿/删除也会触发后台同步。
- 全局工具页生成市场/用户/竞品报告并归档到项目报告库后，会后台同步。
- 按项目 `version` 合并；同版本双端分叉时保留确定性的「冲突副本」。
- 本地删除写入持久化待删除队列；云端不可用时保留队列，下次同步继续处理。
- 云端返回的项目先经过 `migrateProject` 校验和旧数据补齐。
- 自动化覆盖合并、冲突保护和配置安全校验。

## 当前边界

- 跨设备恢复仍需用两个浏览器登录同一邮箱账号做完整 UI 验收。
- 当前自动同步覆盖项目中心进入、项目新建/复制/归档/恢复/删除、五看保存后的项目版本变化、项目编辑、报告定稿/删除、全局工具报告归档。
- 部署环境变量需要配置 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_CLOUD_EMAIL`、`SUPABASE_CLOUD_PASSWORD`；这些值不得提交到代码仓库。
- 文件资产仍保存在本地项目数据中，尚未接入 Supabase Storage。
- 客户端合并可以保护已观察到的同版本分叉，但不能消除“两端同时拉取旧版本后同时写入”的竞态。

## 成员管理与乐观并发（2026-08-27 更新）

- 新增项目成员管理 API `/api/projects/members`：列出、邀请（按邮箱解析 Supabase 用户）、移除、调整角色（editor/viewer）；仅 owner 可管理，成员可读。
- 新增迁移 006：`projects.revision` 乐观锁列、`find_user_id_by_email`、`project_members_with_info`（带成员校验，防枚举）、`push_project_if_revision`（原子版本检查 + owner/editor 权限，仅 service_role 可调用）。
- `pull` 已扩展为「owner 或成员可见」：service_role 模式手动按 `project_members` 扩展可见范围；user token 模式走 RLS。
- `push` 已改为乐观并发写入：service_role 走 RPC，user token 走 PostgREST 带 `revision` 条件的原子更新；冲突时返回云端当前版本，客户端 `reconcilePushConflicts` 用云端版本胜出并保留本地冲突副本后二次推送。
- 客户端项目新增 `cloudRevision` 字段，随数据往返；`migrateProject` 保留；内容比较忽略该字段，避免误判分叉。
- 前端新增成员管理弹窗 `ProjectMembersModal`（项目工作区右上角成员入口）：邀请表单、成员列表、角色徽章、owner 专属的角色调整/移除，editor/viewer 只读。
- 新增迁移 007：`project-assets` Storage 桶 + 基于项目成员角色的 storage.objects RLS（成员可读、owner/editor 可写、owner 可删）。
- 新增资产 API `/api/assets/upload|download|delete|purge`；大型报告正文（>20KB）转存 Storage，恢复时回填；删除报告/项目时级联删除 Storage 文件。

## 进入真实团队同步前的门槛

1. 在真实 Supabase 测试项目执行邮箱账号双浏览器、清空本地数据后恢复项目的验收。
2. ~~增加项目成员邀请/移除/角色调整 UI，并验证 owner/editor/viewer 权限越权~~（已完成：API + UI + 迁移 006；仍待真实环境双浏览器验收）。
3. ~~增加服务端 revision 和带 expected revision 的 RPC，实现乐观并发控制~~（已完成：迁移 006 `push_project_if_revision` + push 改造；仍待真实环境并发验收）。
4. ~~为图片、附件和大型报告接入 Storage，并定义删除级联~~（已完成：迁移 007 + 资产 API + 报告转存/回填/级联；图片/附件按需补充接入）。
5. 执行断网恢复、删除传播和旧 001 项目迁移到 002 权限模型的验收。
