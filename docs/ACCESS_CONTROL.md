# 站点访问控制

GitHub Pages 网址公开。除静态资源外，只有以下 GitHub 身份可以进入站内界面并调用课程业务接口：

| GitHub 账号 | 固定 provider ID |
| --- | --- |
| AmaneSuzuha000 | 177200341 |
| pengguo318 | 30373542 |
| lvliyu7 | 346142220 |

名单只有一处实现：`private.site_identity_allowed` 里硬编码的 provider ID 集合。加人要新建一个 `CREATE OR REPLACE FUNCTION` 的 migration；改旧文件没有用，它已经执行过了，不会重跑。

用户首次用 GitHub 登录时自动关联身份，不需要预建用户。准入不依据可编辑的用户名或 `user_metadata`。白名单不额外授予管理员或课程教师角色。

## 执行位置

React 应用没有页面级门禁，准入在三个地方生效：

- **数据层。** 所有公共表启用 RLS，并叠加一条限制性策略，要求 `private.site_identity_allowed(auth.uid())`。它和原有的选课、所有权规则共同生效（两者取交集），所以通过白名单只意味着「不是外人」，不意味着能读别人的数据。
- **RPC。** `check_site_access()` 只检查当前用户；指定用户的 `check_site_user_access(uuid)` 仅供服务角色执行。
- **Edge Function。** 接收用户请求的函数在 `auth.getUser(jwt)` 校验成功后继续检查白名单。服务角色评测任务与 HMAC 回调不经过这一步，它们不是用户入口。

前端 `RequireAccess` 依据 `profiles.role` 决定能进哪些路由（`staff` 用于 `/teacher`），这是界面引导，不是安全边界：即使绕过它，数据层仍然拒绝。

## 公开边界

静态资源——HTML、JS、教材 Markdown、Notebook、Pyodide WASM——任何人都能直接下载。这是本方案选择的边界：门禁保护的是数据和接口，不是文件保密。

因此凡是不能公开的内容都不进入构建产物。`scripts/assemble_site.py` 是唯一的发布决策点，它当前发布：应用构建、`runtime/`、五份公开文档、README。

**`problems/` 不再发布。** 曾经整目录复制，把 `reference_pyscipopt.py`、`reference_simulation.py`（判题 oracle）、`judge.py` 一并送到公网。前端运行时并不读取该目录——题目陈述由 `scripts/gen-problems.mjs` 在构建时内嵌进 `statements.ts`——所以整个目录都不需要发布。`tests/test_assemble_web.py` 锁定这条规则。

## 验证与维护

`npm test` 覆盖白名单单元测试与执行真实迁移的 SQL 测试：两账号、其他账号、伪造元数据、错误 OAuth provider、RLS、RPC 权限和服务角色。

更新白名单时须新增数据库迁移并同步上表。新增公共表应同时添加准入策略；新增用户入口应复用统一认证助手。

这些检查与测试身份覆盖不等于已经替名单上的人完成真实 GitHub OAuth 登录——真实登录仍由账号持有人操作。
