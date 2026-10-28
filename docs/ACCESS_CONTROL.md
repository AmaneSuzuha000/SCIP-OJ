# 站点访问控制

现有 GitHub Pages 网址保留。只有以下 GitHub 身份可进入站内界面和调用课程业务接口：

| GitHub 账号 | 固定 provider ID |
| --- | --- |
| AmaneSuzuha000 | 177200341 |
| pengguo318 | 30373542 |

用户首次使用 GitHub 登录时自动关联身份，不需要预建用户。准入不依据可编辑的用户名或 `user_metadata`。白名单不额外授予管理员或课程教师角色。

## 执行位置

- 七个门户页面由构建器包装。原业务界面放在 inert template 中；Supabase 服务端准入 RPC 返回 true 后，才挂载界面和依次加载业务脚本。未登录、未授权、配置缺失或验证超时均保留门禁。退出或换账号会重新加载页面，清除原页面及内核。
- `private.site_identity_allowed` 读取 `auth.identities` 中经过 OAuth 绑定的 GitHub provider ID。浏览器的 `check_site_access()` 仅检查当前用户；指定用户的 `check_site_user_access(uuid)` 仅供服务角色执行。
- 所有现有公共 RLS 表增加限制性策略，与原选课和所有权规则共同生效。PostgREST 请求前置检查保护视图和现有 SECURITY DEFINER RPC。实际 HTTP 检查确认 `/graphql/v1` 同样执行该前置检查。不能仅凭撤销 GraphQL schema 授权就声称该接口已关闭：平台授予的权限可能保留。
- 五个接收用户请求的 Edge Function 在 `auth.getUser(jwt)` 校验成功后，继续检查白名单。服务角色评测任务、HMAC 回调及原课程角色校验保留。
- 独立访问 JupyterLite Lab / REPL 会返回门户登录入口。门户授权后创建的内嵌环境正常使用。

GitHub Pages 的 HTML、脚本、教材、Notebook 和 WASM 等静态资源仍可公开获取；这是本次选择的访问边界。页面门禁不提供静态文件保密。

## 验证与维护

`npm test` 包含准入认证单元测试和执行真实迁移的 SQL 测试，覆盖两账号、其他账号、伪造元数据、错误 OAuth provider、RLS、RPC 权限和服务角色。Linux CI 运行完整 Python 检查；Windows 本地有三个既有测试模块依赖 Linux 的 `resource` 模块。

`test_site_access_browser.cjs` 对未修改的构建页面验证七页拦截、两账号启动、退出、换账号及验证故障。原业务回归使用仅监听 localhost 的 `scripts/preview_ui_fixture.py`，该夹具不打包进站点，也不替代真实门禁测试。

上线核对包含生产数据库中的当前账号上下文测试、匿名 REST / GraphQL HTTP 请求，以及公开页面检查。这些检查与测试身份覆盖不等于已经替两位用户完成真实 GitHub OAuth 登录；真实登录仍由账号持有人操作。

更新白名单时须新增数据库迁移并同步此表。新增公共 RLS 表应同时添加准入策略；新增用户入口应复用统一认证助手。变更 PostgREST 暴露 schema 或 GraphQL 路由后，应重新验证实际接口拒绝非白名单请求。
